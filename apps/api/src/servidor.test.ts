import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sembrarCredenciales, sesionMesero, tokenAcceso } from './auth/fixtures-auth';
import { construirServidor } from './servidor';
import type { Servidor } from './servidor';
import { abrirTurno, cerrarConexiones, dispositivo, ID, limpiar } from './sync/fixtures';

const uuid = () => randomUUID();
let srv: Servidor;
let auth: { authorization: string };

beforeAll(async () => {
  srv = await construirServidor(undefined, { limiteGlobal: 100_000, limiteAuth: 100_000 });
  await sembrarCredenciales();
  auth = { authorization: `Bearer ${await tokenAcceso(sesionMesero())}` };
});

beforeEach(async () => {
  await limpiar();
  await abrirTurno();
});

afterAll(async () => {
  await srv.cerrar();
  await cerrarConexiones();
});

function comandaNueva() {
  const cid = uuid();
  const d = dispositivo('A', { dispositivoId: ID.tabletA });
  return {
    cid,
    eventos: [
      d.ev(cid, { tipo: 'comanda_creada', tipoServicio: 'para_llevar' }, { id: uuid() }),
      d.ev(
        cid,
        { tipo: 'linea_agregada', productoId: ID.pastor, nombreProducto: 'Pastor', precioUnitario: 1800, cantidad: 2 },
        { id: uuid(), detalleId: uuid() },
      ),
    ],
  };
}

describe('rutas HTTP', () => {
  it('POST /sync/push guarda y asigna folio; GET /sync/pull lo devuelve', async () => {
    const { cid, eventos } = comandaNueva();

    const push = await srv.app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: auth,
      payload: { dispositivoId: ID.tabletA, eventos },
    });
    expect(push.statusCode).toBe(200);
    const rp = push.json();
    expect(rp.aceptados).toHaveLength(2);
    expect(rp.folios[0]).toMatchObject({ comandaId: cid, folio: 1 });

    const pull = await srv.app.inject({
      method: 'GET',
      url: `/sync/pull?sucursalId=${ID.sucursal}&desde=0`,
      headers: auth,
    });
    expect(pull.statusCode).toBe(200);
    expect(pull.json().eventos).toHaveLength(2);
  });

  it('sin token, el sync devuelve 401 (RS-Z-4)', async () => {
    const { eventos } = comandaNueva();
    const push = await srv.app.inject({ method: 'POST', url: '/sync/push', payload: { dispositivoId: ID.tabletA, eventos } });
    expect(push.statusCode).toBe(401);
    const pull = await srv.app.inject({ method: 'GET', url: `/sync/pull?sucursalId=${ID.sucursal}` });
    expect(pull.statusCode).toBe(401);
  });

  it('un cuerpo inválido devuelve 400', async () => {
    const push = await srv.app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: auth,
      payload: { dispositivoId: 'no-es-uuid', eventos: [] },
    });
    expect(push.statusCode).toBe(400);
  });

  it('/health responde ok', async () => {
    const r = await srv.app.inject({ method: 'GET', url: '/health' });
    expect(r.json()).toEqual({ ok: true });
  });
});

describe('WebSocket + LISTEN/NOTIFY', () => {
  it('un push dispara "hay_novedades" a los suscritos', async () => {
    await srv.app.listen({ port: 0, host: '127.0.0.1' });
    const dir = srv.app.server.address();
    const puerto = typeof dir === 'object' && dir ? dir.port : 0;

    const ws = new WebSocket(`ws://127.0.0.1:${puerto}/sync/ws`);
    await new Promise<void>((res, rej) => {
      ws.addEventListener('open', () => res(), { once: true });
      ws.addEventListener('error', () => rej(new Error('ws no abrió')), { once: true });
    });

    const aviso = new Promise<{ tipo: string; seq: number }>((res) => {
      ws.addEventListener('message', (ev) => res(JSON.parse(String(ev.data))), { once: true });
    });

    ws.send(JSON.stringify({ tipo: 'suscribir', sucursalId: ID.sucursal }));
    // Pequeña espera para que la suscripción quede registrada antes del push.
    await new Promise((r) => setTimeout(r, 50));

    const { eventos } = comandaNueva();
    await srv.app.inject({ method: 'POST', url: '/sync/push', headers: auth, payload: { dispositivoId: ID.tabletA, eventos } });

    const msg = await Promise.race([
      aviso,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('sin aviso en 3s')), 3000)),
    ]);
    expect(msg.tipo).toBe('hay_novedades');
    expect(msg.seq).toBeGreaterThan(0);

    ws.close();
  });
});
