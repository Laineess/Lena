import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sembrarCredenciales, sesionAdmin, sesionMesero, tokenAcceso } from '../auth/fixtures-auth';
import { construirServidor } from '../servidor';
import type { Servidor } from '../servidor';
import { cerrarConexiones, owner } from '../sync/fixtures';

const SUCURSAL_NORTE = '01930000-0000-7000-8000-000000000002';
const ADMIN_NORTE = '01930000-0000-7000-8000-000000000014';
const FECHA = '2026-07-17';

let srv: Servidor;
let admin: { authorization: string };
let adminNorte: { authorization: string };
let mesero: { authorization: string };

async function post(url: string, headers: { authorization: string }, payload: object) {
  const r = await srv.app.inject({ method: 'POST', url, headers, payload });
  return { code: r.statusCode, body: r.json() as Record<string, unknown> };
}
async function get(url: string, headers: { authorization: string }) {
  const r = await srv.app.inject({ method: 'GET', url, headers });
  return { code: r.statusCode, body: r.json() as unknown[] };
}

beforeAll(async () => {
  srv = await construirServidor(undefined, { limiteGlobal: 100_000, limiteAuth: 100_000 });
  await sembrarCredenciales();
  admin = { authorization: `Bearer ${await tokenAcceso(sesionAdmin())}` };
  adminNorte = {
    authorization: `Bearer ${await tokenAcceso({ usuarioId: ADMIN_NORTE, rol: 'administrador', sucursalId: SUCURSAL_NORTE, dispositivoId: null })}`,
  };
  mesero = { authorization: `Bearer ${await tokenAcceso(sesionMesero())}` };
});

beforeEach(async () => {
  await owner.db.execute(sql`TRUNCATE conteo_insumo, compra_insumo, merma, insumo, proveedor RESTART IDENTITY CASCADE`);
});

afterAll(async () => {
  await srv.cerrar();
  await cerrarConexiones();
});

async function crearInsumo(nombre: string, unidad = 'kg') {
  const r = await post('/admin/insumos', admin, { nombre, unidad });
  return r.body.id as string;
}

describe('insumos (Fase 2 · parte A)', () => {
  it('un mesero no puede tocar insumos (403)', async () => {
    const r = await get('/admin/insumos', mesero);
    expect(r.code).toBe(403);
  });

  it('crear insumo y listarlo (RF-L-1)', async () => {
    const id = await crearInsumo('Carne al pastor');
    expect(id).toBeTypeOf('string');
    const lista = await get('/admin/insumos', admin);
    expect((lista.body as { id: string; nombre: string }[]).some((i) => i.id === id)).toBe(true);
  });

  it('consumo derivado = apertura + compras − cierre (RF-L-5)', async () => {
    const carne = await crearInsumo('Carne');
    await post('/admin/conteos', admin, { insumoId: carne, tipo: 'apertura', cantidad: 20, fecha: FECHA });
    await post('/admin/compras', admin, { insumoId: carne, cantidad: 5, costoTotal: 50000, fecha: FECHA });
    await post('/admin/conteos', admin, { insumoId: carne, tipo: 'cierre', cantidad: 8, fecha: FECHA });

    const r = await get(`/admin/consumo?desde=${FECHA}&hasta=${FECHA}`, admin);
    const fila = (r.body as { insumoId: string; consumo: number }[]).find((x) => x.insumoId === carne);
    expect(fila?.consumo).toBe(17); // 20 + 5 − 8
  });

  it('el conteo es único por día/tipo: recapturar pisa, no duplica', async () => {
    const carne = await crearInsumo('Carne');
    await post('/admin/conteos', admin, { insumoId: carne, tipo: 'apertura', cantidad: 20, fecha: FECHA });
    await post('/admin/conteos', admin, { insumoId: carne, tipo: 'apertura', cantidad: 25, fecha: FECHA });
    const r = await get(`/admin/conteos?fecha=${FECHA}`, admin);
    const aperturas = (r.body as { tipo: string; cantidad: number }[]).filter((c) => c.tipo === 'apertura');
    expect(aperturas).toHaveLength(1);
    expect(aperturas[0]?.cantidad).toBe(25);
  });

  it('merma de insumo se registra y aparece en el consumo (RF-L-6)', async () => {
    const carne = await crearInsumo('Carne');
    await post('/admin/conteos', admin, { insumoId: carne, tipo: 'apertura', cantidad: 10, fecha: FECHA });
    await post('/admin/merma-insumo', admin, { insumoId: carne, cantidad: 2, motivo: 'se echó a perder', fecha: FECHA });

    const lista = await get(`/admin/merma-insumo?desde=${FECHA}&hasta=${FECHA}`, admin);
    expect((lista.body as { motivo: string }[])[0]?.motivo).toBe('se echó a perder');
    const consumo = await get(`/admin/consumo?desde=${FECHA}&hasta=${FECHA}`, admin);
    const fila = (consumo.body as { insumoId: string; merma: number }[]).find((x) => x.insumoId === carne);
    expect(fila?.merma).toBe(2);
  });

  it('aislamiento por sucursal: Norte no ve el consumo de Centro (RS-Z-7)', async () => {
    const carne = await crearInsumo('Carne'); // catálogo global
    await post('/admin/conteos', admin, { insumoId: carne, tipo: 'apertura', cantidad: 10, fecha: FECHA });
    await post('/admin/conteos', admin, { insumoId: carne, tipo: 'cierre', cantidad: 4, fecha: FECHA });

    const centro = await get(`/admin/consumo?desde=${FECHA}&hasta=${FECHA}`, admin);
    expect((centro.body as { consumo: number }[])[0]?.consumo).toBe(6);
    const norte = await get(`/admin/consumo?desde=${FECHA}&hasta=${FECHA}`, adminNorte);
    expect(norte.body).toHaveLength(0);
  });
});
