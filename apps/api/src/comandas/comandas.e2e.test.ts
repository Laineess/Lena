import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { construirServidor } from '../servidor';
import type { Servidor } from '../servidor';
import { sembrarCredenciales, sesionMesero, tokenAcceso } from '../auth/fixtures-auth';
import { abrirTurno, app, cerrarConexiones, dispositivo, ID, limpiar } from '../sync/fixtures';
import { procesarPush } from '../sync/push';

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

describe('GET /comandas', () => {
  it('exige sesión', async () => {
    const r = await srv.app.inject({ method: 'GET', url: '/comandas' });
    expect(r.statusCode).toBe(401);
  });

  it('devuelve solo comandas cerradas de la sucursal, con total en centavos', async () => {
    const cid = uuid();
    const d = dispositivo('A');
    // Ciclo completo hasta cobrada.
    await procesarPush(app.db, {
      dispositivoId: ID.tabletA,
      eventos: [
        d.ev(cid, { tipo: 'comanda_creada', tipoServicio: 'para_llevar' }, { id: uuid() }),
        d.ev(
          cid,
          {
            tipo: 'linea_agregada',
            productoId: ID.pastor,
            nombreProducto: 'Pastor',
            precioUnitario: 1800,
            cantidad: 2,
          },
          { id: uuid(), detalleId: uuid() },
        ),
        d.ev(cid, { tipo: 'comanda_enviada' }, { id: uuid() }),
        d.ev(cid, { tipo: 'comanda_entregada' }, { id: uuid() }),
        d.ev(cid, { tipo: 'pago_registrado', metodo: 'efectivo', monto: 3600, recibido: 5000 }, { id: uuid() }),
        d.ev(cid, { tipo: 'comanda_cobrada' }, { id: uuid() }),
      ],
    });

    const r = await srv.app.inject({ method: 'GET', url: '/comandas', headers: auth });
    expect(r.statusCode).toBe(200);
    const filas = r.json() as { id: string; estado: string; total: number }[];
    const nuestra = filas.find((c) => c.id === cid);
    expect(nuestra?.estado).toBe('cobrada');
    expect(nuestra?.total).toBe(3600); // centavos
  });

  it('no incluye comandas abiertas', async () => {
    const cid = uuid();
    const d = dispositivo('A');
    await procesarPush(app.db, {
      dispositivoId: ID.tabletA,
      eventos: [d.ev(cid, { tipo: 'comanda_creada', tipoServicio: 'para_llevar' }, { id: uuid() })],
    });
    const r = await srv.app.inject({ method: 'GET', url: '/comandas', headers: auth });
    const filas = r.json() as { id: string }[];
    expect(filas.find((c) => c.id === cid)).toBeUndefined();
  });
});
