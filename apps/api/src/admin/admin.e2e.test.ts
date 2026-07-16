import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sembrarCredenciales, sesionAdmin, sesionMesero, tokenAcceso } from '../auth/fixtures-auth';
import { construirServidor } from '../servidor';
import type { Servidor } from '../servidor';
import { app, cerrarConexiones, dispositivo, ID, limpiar, owner } from '../sync/fixtures';
import { procesarPush } from '../sync/push';

const uuid = () => randomUUID();
let srv: Servidor;
let admin: { authorization: string };
let mesero: { authorization: string };

async function get(url: string, headers: { authorization: string }) {
  const r = await srv.app.inject({ method: 'GET', url, headers });
  return { code: r.statusCode, body: r.json() as Record<string, unknown> & unknown[] };
}

beforeAll(async () => {
  srv = await construirServidor(undefined, { limiteGlobal: 100_000, limiteAuth: 100_000 });
  await sembrarCredenciales();
  admin = { authorization: `Bearer ${await tokenAcceso(sesionAdmin())}` };
  mesero = { authorization: `Bearer ${await tokenAcceso(sesionMesero())}` };
});

beforeEach(async () => {
  await limpiar();
  await owner.db.execute(
    // Un turno abierto (con id fijo) para que las comandas se enlacen.
    (await import('drizzle-orm')).sql`
      INSERT INTO corte_caja (id, sucursal_id, fondo_inicial, abierto_por, estado)
      VALUES (${ID.corte}, ${ID.sucursal}, '1000', ${ID.mesero1}, 'abierto')`,
  );
});

afterAll(async () => {
  await srv.cerrar();
  await cerrarConexiones();
});

// Comanda cobrada por Ana: creada→…→pago→cobrada. Total 3600.
function cobrada() {
  const cid = uuid();
  const d = dispositivo('A');
  return {
    cid,
    eventos: [
      d.ev(cid, { tipo: 'comanda_creada', tipoServicio: 'para_llevar' }, { id: uuid() }),
      d.ev(
        cid,
        { tipo: 'linea_agregada', productoId: ID.pastor, nombreProducto: 'Pastor', precioUnitario: 1800, cantidad: 2 },
        { id: uuid(), detalleId: uuid() },
      ),
      d.ev(cid, { tipo: 'comanda_enviada' }, { id: uuid() }),
      d.ev(cid, { tipo: 'comanda_entregada' }, { id: uuid() }),
      d.ev(cid, { tipo: 'pago_registrado', metodo: 'efectivo', monto: 3600, recibido: 3600 }, { id: uuid() }),
      d.ev(cid, { tipo: 'comanda_cobrada' }, { id: uuid() }),
    ],
  };
}

// Comanda cancelada por Ana con una línea ya enviada → merma.
function cancelada() {
  const cid = uuid();
  const det = uuid();
  const d = dispositivo('A');
  return {
    cid,
    eventos: [
      d.ev(cid, { tipo: 'comanda_creada', tipoServicio: 'para_llevar' }, { id: uuid() }),
      d.ev(
        cid,
        { tipo: 'linea_agregada', productoId: ID.pastor, nombreProducto: 'Pastor', precioUnitario: 1800, cantidad: 3 },
        { id: uuid(), detalleId: det },
      ),
      d.ev(cid, { tipo: 'comanda_enviada' }, { id: uuid() }),
      d.ev(cid, { tipo: 'comanda_cancelada', motivo: 'el cliente se fue' }, { id: uuid() }),
    ],
  };
}

describe('reportes del administrador', () => {
  it('los endpoints exigen rol administrador (un mesero → 403)', async () => {
    const r = await get('/admin/resumen', mesero);
    expect(r.code).toBe(403);
  });

  it('resumen: ventas, comandas, ticket y merma del periodo', async () => {
    await procesarPush(app.db, { dispositivoId: ID.tabletA, eventos: cobrada().eventos });
    await procesarPush(app.db, { dispositivoId: ID.tabletA, eventos: cobrada().eventos });
    await procesarPush(app.db, { dispositivoId: ID.tabletA, eventos: cancelada().eventos });

    const r = await get('/admin/resumen', admin);
    expect(r.code).toBe(200);
    expect(r.body).toMatchObject({ ventas: 7200, comandas: 2, ticket: 3600 });
    expect(Number(r.body.merma)).toBe(5400); // 3 × $18
  });

  it('merma por mesero: la mitigación de T1 (comandas, canceladas, tasa, merma)', async () => {
    await procesarPush(app.db, { dispositivoId: ID.tabletA, eventos: cobrada().eventos });
    await procesarPush(app.db, { dispositivoId: ID.tabletA, eventos: cancelada().eventos });

    const r = await get('/admin/merma', admin);
    expect(r.code).toBe(200);
    const ana = (r.body.meseros as { id: string; comandas: number; canceladas: number; merma: number }[]).find(
      (m) => m.id === ID.mesero1,
    );
    expect(ana).toMatchObject({ comandas: 2, canceladas: 1, merma: 5400 });
    expect(Number(r.body.total)).toBe(5400);
  });

  it('canceladas: motivo, autor y costo mermado (RF-I-9)', async () => {
    await procesarPush(app.db, { dispositivoId: ID.tabletA, eventos: cancelada().eventos });
    const r = await get('/admin/canceladas', admin);
    expect((r.body as unknown as unknown[]).length).toBe(1);
    expect((r.body as unknown as { motivo: string; costoMermado: number }[])[0]).toMatchObject({
      motivo: 'el cliente se fue',
      costoMermado: 5400,
    });
  });

  it('export CSV de canceladas (RF-I-8)', async () => {
    await procesarPush(app.db, { dispositivoId: ID.tabletA, eventos: cancelada().eventos });
    const r = await srv.app.inject({ method: 'GET', url: '/admin/export/canceladas', headers: admin });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/csv');
    expect(r.body).toContain('el cliente se fue');
    expect(r.body).toContain('54.00');
  });
});

describe('gestión del administrador', () => {
  it('cambiar precio deja historial (RF-D-4) y no altera ventas viejas (RNF-I-1)', async () => {
    // Ana vende un Pastor a $18 (snapshot).
    await procesarPush(app.db, { dispositivoId: ID.tabletA, eventos: cobrada().eventos });

    // El admin sube el precio a $22.
    const patch = await srv.app.inject({
      method: 'PATCH',
      url: `/admin/productos/${ID.pastor}/precio`,
      headers: admin,
      payload: { precio: 2200 },
    });
    expect(patch.statusCode).toBe(200);

    // El historial registra el cambio.
    const hist = await get(`/admin/productos/${ID.pastor}/precios`, admin);
    expect((hist.body as unknown as unknown[]).length).toBeGreaterThan(0);

    // La venta vieja sigue siendo $36 (2×$18): el precio nuevo no la tocó.
    const resumen = await get('/admin/resumen', admin);
    expect(resumen.body.ventas).toBe(3600);

    // Restaurar el precio para no afectar otros tests.
    await srv.app.inject({
      method: 'PATCH',
      url: `/admin/productos/${ID.pastor}/precio`,
      headers: admin,
      payload: { precio: 1800 },
    });
  });

  it('reabrir una comanda cobrada (RF-G-8) la saca del estado cobrada', async () => {
    const c = cobrada();
    await procesarPush(app.db, { dispositivoId: ID.tabletA, eventos: c.eventos });

    const r = await srv.app.inject({
      method: 'POST',
      url: `/admin/comandas/${c.cid}/reabrir`,
      headers: admin,
      payload: { motivo: 'cobro equivocado' },
    });
    expect(r.statusCode).toBe(200);

    const { sql } = await import('drizzle-orm');
    const filas = (await app.db.execute(sql`SELECT estado FROM comanda WHERE id = ${c.cid}`)) as unknown as {
      estado: string;
    }[];
    expect(filas[0]?.estado).not.toBe('cobrada');
  });

  it('crear usuario con PIN inválido se rechaza (RS-A-6)', async () => {
    const r = await srv.app.inject({
      method: 'POST',
      url: '/admin/usuarios',
      headers: admin,
      payload: { nombre: 'Nuevo', rol: 'mesero', sucursalId: ID.sucursal, pin: '123456' },
    });
    expect(r.statusCode).toBe(400);
    expect((r.json() as { error: string }).error).toBe('pin_invalido');
  });
});
