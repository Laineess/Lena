import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sembrarCredenciales, sesionAdmin, sesionMesero, sesionSuperadmin, tokenAcceso } from '../auth/fixtures-auth';
import { construirServidor } from '../servidor';
import type { Servidor } from '../servidor';
import { app, cerrarConexiones, dispositivo, ID, limpiar, owner } from '../sync/fixtures';
import { procesarPush } from '../sync/push';

const SUCURSAL_NORTE = '01930000-0000-7000-8000-000000000002';
const ADMIN_NORTE = '01930000-0000-7000-8000-000000000014';

const uuid = () => randomUUID();
let srv: Servidor;
let admin: { authorization: string };
let adminNorte: { authorization: string };
let superadmin: { authorization: string };
let mesero: { authorization: string };

async function get(url: string, headers: { authorization: string }) {
  const r = await srv.app.inject({ method: 'GET', url, headers });
  return { code: r.statusCode, body: r.json() as Record<string, unknown> & unknown[] };
}

beforeAll(async () => {
  srv = await construirServidor(undefined, { limiteGlobal: 100_000, limiteAuth: 100_000 });
  await sembrarCredenciales();
  admin = { authorization: `Bearer ${await tokenAcceso(sesionAdmin())}` };
  adminNorte = {
    authorization: `Bearer ${await tokenAcceso({
      usuarioId: ADMIN_NORTE,
      rol: 'administrador',
      sucursalId: SUCURSAL_NORTE,
      dispositivoId: null,
    })}`,
  };
  superadmin = { authorization: `Bearer ${await tokenAcceso(sesionSuperadmin())}` };
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

  it('el push sella la sync del dispositivo; el admin ve los minutos (RNF-O-5)', async () => {
    await procesarPush(app.db, { dispositivoId: ID.tabletA, eventos: cobrada().eventos });
    const r = await get('/admin/dispositivos', admin);
    const tab = (r.body as unknown as { id: string; minutosSinSync: number | null }[]).find((d) => d.id === ID.tabletA);
    expect(tab).toBeDefined();
    expect(tab?.minutosSinSync).toBe(0); // acaba de sincronizar
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

  it('crear producto con categoría nueva y subcategoría; aparece en el catálogo (RF-D-6)', async () => {
    const r = await srv.app.inject({
      method: 'POST',
      url: '/admin/productos',
      headers: admin,
      payload: { nombre: 'Gringa', categoria: 'Especiales', subcategoria: 'De la casa', precio: 3500 },
    });
    expect(r.statusCode).toBe(200);
    const id = (r.json() as { id: string }).id;

    const cat = await get('/catalogo', mesero);
    const gringa = (cat.body.productos as unknown as { nombre: string; subcategoria: string | null }[]).find(
      (p) => p.nombre === 'Gringa',
    );
    expect(gringa?.subcategoria).toBe('De la casa');

    const { sql } = await import('drizzle-orm');
    await owner.db.execute(sql`DELETE FROM producto WHERE id = ${id}`);
    await owner.db.execute(sql`DELETE FROM categoria WHERE nombre = 'Especiales'`);
  });

  it('marcar producto agotado y reactivarlo (RF-D-7)', async () => {
    const off = await srv.app.inject({
      method: 'PATCH',
      url: `/productos/${ID.pastor}/disponibilidad`,
      headers: admin,
      payload: { disponible: false },
    });
    expect((off.json() as { disponible: boolean }).disponible).toBe(false);
    const on = await srv.app.inject({
      method: 'PATCH',
      url: `/productos/${ID.pastor}/disponibilidad`,
      headers: admin,
      payload: { disponible: true },
    });
    expect((on.json() as { disponible: boolean }).disponible).toBe(true);
  });

  it('precio por sucursal: el override gana al base (RF-D-8)', async () => {
    // El admin de Centro fija Pastor en $20 (base $18).
    const r = await srv.app.inject({
      method: 'PUT',
      url: `/admin/productos/${ID.pastor}/precio-sucursal`,
      headers: admin,
      payload: { precio: 2000 },
    });
    expect(r.statusCode).toBe(200);
    const cat = await get('/catalogo', mesero);
    const pastor = (cat.body.productos as unknown as { id: string; precio: number }[]).find((p) => p.id === ID.pastor);
    expect(pastor?.precio).toBe(2000);
    // Quitar override → vuelve al base.
    await srv.app.inject({ method: 'DELETE', url: `/admin/productos/${ID.pastor}/precio-sucursal`, headers: admin });
    const cat2 = await get('/catalogo', mesero);
    const base = (cat2.body.productos as unknown as { id: string; precio: number }[]).find((p) => p.id === ID.pastor);
    expect(base?.precio).toBe(1800);
  });

  it('agotar en una sucursal NO afecta a otra (RF-D-7 por sucursal)', async () => {
    // El superadmin agota Pastor en Norte.
    await srv.app.inject({
      method: 'PATCH',
      url: `/productos/${ID.pastor}/disponibilidad`,
      headers: superadmin,
      payload: { disponible: false, sucursalId: SUCURSAL_NORTE },
    });
    // El mesero de Centro sigue viéndolo disponible.
    const centro = await get('/catalogo', mesero);
    const pC = (centro.body.productos as unknown as { id: string; disponible: boolean }[]).find((p) => p.id === ID.pastor);
    expect(pC?.disponible).toBe(true);
    // En Norte (catálogo con ?sucursalId) está agotado.
    const norte = await get(`/catalogo?sucursalId=${SUCURSAL_NORTE}`, superadmin);
    const pN = (norte.body.productos as unknown as { id: string; disponible: boolean }[]).find((p) => p.id === ID.pastor);
    expect(pN?.disponible).toBe(false);

    const { sql } = await import('drizzle-orm');
    await owner.db.execute(sql`DELETE FROM producto_disponibilidad WHERE sucursal_id = ${SUCURSAL_NORTE}`);
  });

  it('el superadmin cambia la clave de una sucursal; la vieja deja de servir (RF-B)', async () => {
    const r = await srv.app.inject({
      method: 'PATCH',
      url: `/admin/sucursales/${SUCURSAL_NORTE}`,
      headers: superadmin,
      payload: { clave: 'NORTE9' },
    });
    expect(r.statusCode).toBe(200);
    const vieja = await srv.app.inject({ method: 'POST', url: '/auth/sucursal', payload: { clave: 'NORTE' } });
    expect(vieja.statusCode).toBe(401);
    const nueva = await srv.app.inject({ method: 'POST', url: '/auth/sucursal', payload: { clave: 'NORTE9' } });
    expect(nueva.statusCode).toBe(200);
    // Restaurar para no afectar a otros tests.
    await srv.app.inject({
      method: 'PATCH',
      url: `/admin/sucursales/${SUCURSAL_NORTE}`,
      headers: superadmin,
      payload: { clave: 'NORTE' },
    });
  });
});

describe('roles: superadmin vs administrador', () => {
  it('login por email respeta el rol del servidor (superadmin es global)', async () => {
    const r = await srv.app.inject({
      method: 'POST',
      url: '/auth/login/admin',
      payload: { email: 'super@lena.local', password: 'ClaveSuper2026x' },
    });
    expect(r.statusCode).toBe(200);
    const s = (r.json() as { sesion: { rol: string; sucursalId: string | null } }).sesion;
    expect(s.rol).toBe('superadmin');
    expect(s.sucursalId).toBeNull();
  });

  it('crear sucursal: superadmin sí, administrador 403 (RF-B-1)', async () => {
    const ok = await srv.app.inject({
      method: 'POST',
      url: '/admin/sucursales',
      headers: superadmin,
      payload: { nombre: `Sur ${uuid().slice(0, 8)}` },
    });
    expect(ok.statusCode).toBe(200);
    await owner.db.execute(
      (await import('drizzle-orm')).sql`DELETE FROM sucursal WHERE id = ${(ok.json() as { id: string }).id}`,
    );

    const no = await srv.app.inject({
      method: 'POST',
      url: '/admin/sucursales',
      headers: admin,
      payload: { nombre: 'No debería' },
    });
    expect(no.statusCode).toBe(403);
  });

  it('alta de administrador: superadmin sí, administrador 403 (RF-C-1)', async () => {
    const ok = await srv.app.inject({
      method: 'POST',
      url: '/admin/admins',
      headers: superadmin,
      payload: { nombre: 'Gerente 2', email: `g2-${uuid().slice(0, 8)}@lena.local`, password: 'ClaveAdmin2026x', sucursalId: ID.sucursal },
    });
    expect(ok.statusCode).toBe(200);
    await owner.db.execute(
      (await import('drizzle-orm')).sql`DELETE FROM usuario WHERE id = ${(ok.json() as { id: string }).id}`,
    );

    const no = await srv.app.inject({
      method: 'POST',
      url: '/admin/admins',
      headers: admin,
      payload: { nombre: 'X', email: `x-${uuid().slice(0, 8)}@lena.local`, password: 'ClaveAdmin2026x', sucursalId: ID.sucursal },
    });
    expect(no.statusCode).toBe(403);
  });

  it('caja del día: venta y turno abierto por sucursal en alcance (RF-H)', async () => {
    await procesarPush(app.db, { dispositivoId: ID.tabletA, eventos: cobrada().eventos });

    // El admin de Centro ve solo Centro, con el turno abierto y su venta.
    const centro = await get('/admin/caja', admin);
    expect(centro.body).toHaveLength(1);
    const c = (centro.body as unknown as { sucursal: string; ventas: number; turnoAbierto: boolean }[])[0];
    expect(c?.ventas).toBe(3600);
    expect(c?.turnoAbierto).toBe(true);

    // El superadmin ve todas las sucursales.
    const sup = await get('/admin/caja', superadmin);
    expect((sup.body as unknown as unknown[]).length).toBeGreaterThanOrEqual(2);
  });

  it('el administrador solo ve su sucursal; el superadmin ve todo (RS-Z-2)', async () => {
    // Ana (Centro) cobra 3600.
    await procesarPush(app.db, { dispositivoId: ID.tabletA, eventos: cobrada().eventos });

    const centro = await get('/admin/resumen', admin);
    expect(centro.body.ventas).toBe(3600);

    // El admin de Norte no ve las ventas de Centro.
    const norte = await get('/admin/resumen', adminNorte);
    expect(norte.body.ventas).toBe(0);

    // El superadmin ve el total (todas las sucursales).
    const sup = await get('/admin/resumen', superadmin);
    expect(sup.body.ventas).toBe(3600);
  });
});
