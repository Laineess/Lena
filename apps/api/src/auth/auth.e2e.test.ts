import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { construirServidor } from '../servidor';
import type { Servidor } from '../servidor';
import { abrirTurno, cerrarConexiones, dispositivo, ID, limpiar, owner } from '../sync/fixtures';
import { CRED, limpiarAuth, sembrarCredenciales } from './fixtures-auth';

const uuid = () => randomUUID();
let srv: Servidor;

async function post(url: string, payload: object, headers: Record<string, string> = {}) {
  const r = await srv.app.inject({ method: 'POST', url, payload: payload as Record<string, unknown>, headers });
  return { code: r.statusCode, body: r.json() as Record<string, unknown> };
}

beforeAll(async () => {
  srv = await construirServidor(undefined, { limiteGlobal: 100_000, limiteAuth: 100_000 });
  await sembrarCredenciales();
});

beforeEach(async () => {
  await limpiar();
  await limpiarAuth();
  await abrirTurno();
  // Reactivar dispositivos (algún test los revoca).
  await owner.db.execute(sql`UPDATE dispositivo SET activo = true WHERE id IN (${ID.tabletA}, ${ID.tabletB})`);
});

afterAll(async () => {
  await srv.cerrar();
  await cerrarConexiones();
});

// ── Login de administrador ───────────────────────────────────

describe('login admin', () => {
  it('con credenciales correctas emite acceso y refresh', async () => {
    const r = await post('/auth/login/admin', { email: CRED.emailAdmin, password: CRED.passwordAdmin });
    expect(r.code).toBe(200);
    expect(r.body.acceso).toBeTypeOf('string');
    expect((r.body.sesion as { rol: string }).rol).toBe('administrador');
  });

  it('con contraseña incorrecta niega (401)', async () => {
    const r = await post('/auth/login/admin', { email: CRED.emailAdmin, password: 'incorrecta1234' });
    expect(r.code).toBe(401);
  });
});

// ── Login por PIN + dispositivo ──────────────────────────────

describe('login PIN', () => {
  const bueno = () => ({
    dispositivoId: ID.tabletA,
    tokenDispositivo: CRED.tokenTabletA,
    usuarioId: ID.mesero1,
    pin: CRED.pinMesero,
  });

  it('con dispositivo válido y PIN correcto entra; la sucursal sale del servidor', async () => {
    const r = await post('/auth/login/pin', bueno());
    expect(r.code).toBe(200);
    // RS-Z-2: la sucursal la fija el servidor desde el dispositivo.
    expect((r.body.sesion as { sucursalId: string }).sucursalId).toBe(ID.sucursal);
  });

  it('un dispositivo sin credencial válida no entra (RS-A-3)', async () => {
    const r = await post('/auth/login/pin', { ...bueno(), tokenDispositivo: 'token-falso' });
    expect(r.code).toBe(401);
  });

  it('PIN incorrecto niega', async () => {
    const r = await post('/auth/login/pin', { ...bueno(), pin: '999998' });
    expect(r.code).toBe(401);
  });

  it('se bloquea tras 5 intentos fallidos (RS-A-4)', async () => {
    for (let i = 0; i < 5; i++) await post('/auth/login/pin', { ...bueno(), pin: '999998' });
    // El 6º, incluso con PIN correcto, está bloqueado.
    const r = await post('/auth/login/pin', bueno());
    expect(r.code).toBe(401);
    expect(r.body.bloqueadoHasta).toBeTypeOf('number');
  });
});

// ── Refresh rotatorio y detección de reuso (RS-A-12) ─────────

describe('refresh', () => {
  it('rota el token y detecta el reuso del viejo', async () => {
    const login = await post('/auth/login/pin', {
      dispositivoId: ID.tabletA,
      tokenDispositivo: CRED.tokenTabletA,
      usuarioId: ID.mesero1,
      pin: CRED.pinMesero,
    });
    const refresh1 = login.body.refresh as string;

    const r1 = await post('/auth/refresh', { refresh: refresh1 });
    expect(r1.code).toBe(200);
    const refresh2 = r1.body.refresh as string;
    expect(refresh2).not.toBe(refresh1);

    // Reusar el viejo = robo → se revoca la familia entera.
    const reuso = await post('/auth/refresh', { refresh: refresh1 });
    expect(reuso.code).toBe(401);

    // Y el token nuevo tampoco sirve ya: la familia murió.
    const r2 = await post('/auth/refresh', { refresh: refresh2 });
    expect(r2.code).toBe(401);
  });
});

// ── Revocación de dispositivo (RS-A-9) ───────────────────────

describe('revocación de dispositivo', () => {
  it('un dispositivo revocado pierde acceso al refrescar', async () => {
    const login = await post('/auth/login/pin', {
      dispositivoId: ID.tabletA,
      tokenDispositivo: CRED.tokenTabletA,
      usuarioId: ID.mesero1,
      pin: CRED.pinMesero,
    });
    const refresh = login.body.refresh as string;

    await owner.db.execute(sql`UPDATE dispositivo SET activo = false WHERE id = ${ID.tabletA}`);

    const r = await post('/auth/refresh', { refresh });
    expect(r.code).toBe(401);
    expect(r.body.error).toContain('dispositivo');
  });
});

// ── RS-T-7: rate limiting en auth ────────────────────────────

describe('rate limiting', () => {
  it('el endpoint de login corta al pasar el límite (429)', async () => {
    // Servidor propio con límite bajo para no afectar a los demás tests.
    const chico = await construirServidor(undefined, { limiteAuth: 3 });
    try {
      const cred = { email: CRED.emailAdmin, password: 'incorrecta1234' };
      const codigos: number[] = [];
      for (let i = 0; i < 6; i++) {
        const r = await chico.app.inject({ method: 'POST', url: '/auth/login/admin', payload: cred });
        codigos.push(r.statusCode);
      }
      expect(codigos).toContain(429); // en algún momento se corta
    } finally {
      await chico.cerrar();
    }
  });
});

// ── RS-Z-6: no se empujan eventos de otra sucursal ───────────

describe('aislamiento de sucursal', () => {
  it('un mesero no puede empujar un evento de otra sucursal', async () => {
    const login = await post('/auth/login/pin', {
      dispositivoId: ID.tabletA,
      tokenDispositivo: CRED.tokenTabletA,
      usuarioId: ID.mesero1,
      pin: CRED.pinMesero,
    });
    const acceso = login.body.acceso as string;

    // Evento con una sucursal ajena a la de la sesión.
    const otraSucursal = uuid();
    const d = dispositivo('A', { dispositivoId: ID.tabletA });
    const evento = {
      ...d.ev(uuid(), { tipo: 'comanda_creada', tipoServicio: 'para_llevar' }, { id: uuid() }),
      sucursalId: otraSucursal,
    };

    const r = await srv.app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: { authorization: `Bearer ${acceso}` },
      payload: { dispositivoId: ID.tabletA, eventos: [evento] },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { rechazados: { razon: string }[] };
    expect(body.rechazados[0]?.razon).toBe('sucursal_ajena');
  });
});
