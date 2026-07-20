import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sembrarCredenciales, sesionAdmin, tokenAcceso } from '../auth/fixtures-auth';
import { construirServidor } from '../servidor';
import type { Servidor } from '../servidor';
import { cerrarConexiones, ID, limpiar, owner } from '../sync/fixtures';

let srv: Servidor;
let admin: { authorization: string };
const INSUMO = '01930000-0000-7000-8000-0000000f0001';

async function get(url: string) {
  const r = await srv.app.inject({ method: 'GET', url, headers: admin });
  return { code: r.statusCode, body: r.json() as Record<string, unknown>[] };
}

// Siembra N días: ventas que varían (para que regr_slope tenga varianza) y un
// consumo del insumo perfectamente lineal (0.1 por unidad vendida) → ratio 0.1.
async function sembrarHistoria(dias: number) {
  const base = new Date('2026-06-01T00:00:00Z').getTime();
  for (let k = 0; k < dias; k++) {
    const fecha = new Date(base + k * 86_400_000).toISOString().slice(0, 10);
    const unidades = 10 + k; // varía día a día
    const consumo = 0.1 * unidades; // relación lineal exacta
    const cid = randomUUID();
    await owner.db.execute(sql`
      INSERT INTO comanda (id, sucursal_id, corte_caja_id, tipo_servicio, mesero_id, estado, total, abierta_at, cerrada_at)
      VALUES (${cid}, ${ID.sucursal}, ${ID.corte}, 'para_llevar', ${ID.mesero1}, 'cobrada', '0', ${`${fecha}T18:00:00Z`}, ${`${fecha}T18:00:00Z`})`);
    await owner.db.execute(sql`
      INSERT INTO comanda_detalle (id, comanda_id, producto_id, nombre_producto, precio_unitario, cantidad, estado, enviada_at, lista_at)
      VALUES (${randomUUID()}, ${cid}, ${ID.pastor}, 'Pastor', '18.00', ${unidades}, 'lista', ${`${fecha}T18:00:00Z`}, ${`${fecha}T18:00:00Z`})`);
    await owner.db.execute(sql`
      INSERT INTO conteo_insumo (id, sucursal_id, insumo_id, tipo, cantidad, fecha, actor_id)
      VALUES (${randomUUID()}, ${ID.sucursal}, ${INSUMO}, 'apertura', '10', ${fecha}, ${ID.mesero1})`);
    await owner.db.execute(sql`
      INSERT INTO conteo_insumo (id, sucursal_id, insumo_id, tipo, cantidad, fecha, actor_id)
      VALUES (${randomUUID()}, ${ID.sucursal}, ${INSUMO}, 'cierre', ${String(10 - consumo)}, ${fecha}, ${ID.mesero1})`);
  }
}

beforeAll(async () => {
  srv = await construirServidor(undefined, { limiteGlobal: 100_000, limiteAuth: 100_000 });
  await sembrarCredenciales();
  admin = { authorization: `Bearer ${await tokenAcceso(sesionAdmin())}` };
});

beforeEach(async () => {
  // limpiar() trunca comandas y corte_caja (evita chocar el índice de "un turno
  // abierto por sucursal" con lo que dejó otro archivo de prueba).
  await limpiar();
  await owner.db.execute(sql`
    INSERT INTO corte_caja (id, sucursal_id, fondo_inicial, abierto_por, estado)
    VALUES (${ID.corte}, ${ID.sucursal}, '1000', ${ID.mesero1}, 'abierto')`);
  await owner.db.execute(sql`TRUNCATE conteo_insumo, compra_insumo, merma, insumo_parametro, insumo RESTART IDENTITY CASCADE`);
  await owner.db.execute(sql`INSERT INTO insumo (id, nombre, unidad) VALUES (${INSUMO}, 'Carne', 'kg')`);
});

afterAll(async () => {
  // No dejar un corte abierto ni comandas para el siguiente archivo de prueba.
  await limpiar();
  await srv.cerrar();
  await cerrarConexiones();
});

describe('compra sugerida (Fase 2 · parte B)', () => {
  it('sin sucursal no aplica; necesita una (RS-Z-7)', async () => {
    // El admin siempre trae sucursal; probamos que responde 200 con datos.
    const r = await get('/admin/compra-sugerida');
    expect(r.code).toBe(200);
  });

  it('aprende el ratio insumo↔venta con regr_slope (RF-M-1) y recomienda (RF-M-3)', async () => {
    await sembrarHistoria(20);
    // Horizonte más largo + colchón para que recomiende un número > 0.
    await srv.app.inject({
      method: 'PUT',
      url: `/admin/insumos/${INSUMO}/parametro`,
      headers: admin,
      payload: { stockSeguridad: 5, diasEntrega: 7 },
    });

    const r = await get('/admin/compra-sugerida');
    const carne = r.body.find((x) => x.insumoId === INSUMO) as {
      ratio: number;
      dias: number;
      confianza: string;
      recomendado: number | null;
      previstoUnidades: number;
    };
    expect(carne.ratio).toBeCloseTo(0.1, 2); // 0.1 kg por unidad vendida
    expect(carne.dias).toBe(20);
    expect(carne.confianza).toBe('media'); // 14–27 días
    expect(carne.previstoUnidades).toBeGreaterThan(0);
    expect(typeof carne.recomendado).toBe('number');
    expect(carne.recomendado).toBeGreaterThan(0);
  });

  it('con historial pobre avisa en vez de recomendar (RF-M-6)', async () => {
    await sembrarHistoria(5);
    const r = await get('/admin/compra-sugerida');
    const carne = r.body.find((x) => x.insumoId === INSUMO) as { confianza: string; recomendado: number | null };
    expect(carne.confianza).toBe('insuficiente');
    expect(carne.recomendado).toBeNull();
  });
});
