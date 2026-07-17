import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pago } from '@lena/db';
import { sembrarCredenciales, sesionAdmin, tokenAcceso } from '../auth/fixtures-auth';
import { construirServidor } from '../servidor';
import type { Servidor } from '../servidor';
import { app, cerrarConexiones, dispositivo, ID, limpiar, owner } from '../sync/fixtures';
import { procesarPush } from '../sync/push';

const uuid = () => randomUUID();
let srv: Servidor;
let auth: { authorization: string };

async function post(url: string, payload: object) {
  const r = await srv.app.inject({ method: 'POST', url, headers: auth, payload });
  return { code: r.statusCode, body: r.json() as Record<string, unknown> };
}

beforeAll(async () => {
  srv = await construirServidor(undefined, { limiteGlobal: 100_000, limiteAuth: 100_000 });
  await sembrarCredenciales();
  // El turno lo maneja el administrador (de su sucursal), ya no el mesero.
  auth = { authorization: `Bearer ${await tokenAcceso(sesionAdmin())}` };
});

beforeEach(async () => {
  await limpiar();
  // Sin turnos previos: los tests de turno manejan su propio ciclo.
  await owner.db.execute(sql`DELETE FROM corte_caja WHERE sucursal_id = ${ID.sucursal}`);
});

afterAll(async () => {
  await srv.cerrar();
  await cerrarConexiones();
});

// Empuja una comanda por su ciclo completo hasta cobrada, con un pago dado.
function comandaCobrada(cid: string, montoPago: number, recibido: number) {
  const d = dispositivo('A');
  return [
    d.ev(cid, { tipo: 'comanda_creada', tipoServicio: 'para_llevar' }, { id: uuid() }),
    d.ev(
      cid,
      { tipo: 'linea_agregada', productoId: ID.pastor, nombreProducto: 'Pastor', precioUnitario: 1800, cantidad: 2 },
      { id: uuid(), detalleId: uuid() },
    ),
    d.ev(cid, { tipo: 'comanda_enviada' }, { id: uuid() }),
    d.ev(cid, { tipo: 'comanda_entregada' }, { id: uuid() }),
    d.ev(cid, { tipo: 'pago_registrado', metodo: 'efectivo', monto: montoPago, recibido }, { id: uuid() }),
    d.ev(cid, { tipo: 'comanda_cobrada' }, { id: uuid() }),
  ];
}

describe('turno de caja', () => {
  it('abre, aparece en /actual y no deja abrir un segundo (RNF-I-4)', async () => {
    const r = await post('/turno/abrir', { fondoInicial: 100_000 });
    expect(r.code).toBe(200);

    const actual = await srv.app.inject({ method: 'GET', url: '/turno/actual', headers: auth });
    expect((actual.json() as { fondoInicial: number }).fondoInicial).toBe(100_000);

    const segundo = await post('/turno/abrir', { fondoInicial: 50_000 });
    expect(segundo.code).toBe(409);
    expect(segundo.body.error).toBe('turno_ya_abierto');
  });

  it('no cierra con comandas abiertas y las lista (RF-H-8)', async () => {
    await post('/turno/abrir', { fondoInicial: 100_000 });
    // Una comanda solo creada (abierta).
    const cid = uuid();
    const d = dispositivo('A');
    await procesarPush(app.db, {
      dispositivoId: ID.tabletA,
      eventos: [d.ev(cid, { tipo: 'comanda_creada', tipoServicio: 'para_llevar' }, { id: uuid() })],
    });

    const r = await post('/turno/cerrar', { contadoEfectivo: 100_000 });
    expect(r.code).toBe(409);
    expect(r.body.error).toBe('comandas_abiertas');
    expect((r.body.comandas as unknown[]).length).toBe(1);
  });

  it('cierra: esperado = fondo + efectivo cobrado; diferencia y desglose (RF-H-4/5/6)', async () => {
    await post('/turno/abrir', { fondoInicial: 100_000 }); // $1000

    const cid = uuid();
    const r = await procesarPush(app.db, {
      dispositivoId: ID.tabletA,
      eventos: comandaCobrada(cid, 3600, 5000), // paga $36 exactos
    });
    expect(r.rechazados).toHaveLength(0);

    // El pago se materializó (para el corte).
    const [p] = await app.db.select().from(pago).where(eq(pago.comandaId, cid));
    expect(p?.monto).toBe('36.00');
    expect(p?.cambio).toBe('14.00'); // recibió $50

    const cierre = await post('/turno/cerrar', { contadoEfectivo: 103_600 });
    expect(cierre.code).toBe(200);
    expect(cierre.body.esperado).toBe(103_600); // 100000 + 3600
    expect(cierre.body.diferencia).toBe(0);
    expect(cierre.body.desglose).toMatchObject({ efectivo: 3600, tarjeta: 0, transferencia: 0 });
  });

  it('exige motivo si la diferencia supera el umbral (RF-H-7)', async () => {
    await post('/turno/abrir', { fondoInicial: 100_000 });
    // Cierra con un faltante grande y sin motivo.
    const r = await post('/turno/cerrar', { contadoEfectivo: 90_000 });
    expect(r.code).toBe(400);
    expect(r.body.error).toBe('motivo_requerido');
    // Con motivo, procede.
    const ok = await post('/turno/cerrar', { contadoEfectivo: 90_000, motivo: 'faltó un billete' });
    expect(ok.code).toBe(200);
    expect(ok.body.diferencia).toBe(-10_000);
  });
});

describe('RNF-I-2 — los pagos igualan el total', () => {
  it('el servidor rechaza cobrar si los pagos no cuadran', async () => {
    await post('/turno/abrir', { fondoInicial: 100_000 });
    const cid = uuid();
    // Total 3600 pero solo paga 1000.
    const r = await procesarPush(app.db, {
      dispositivoId: ID.tabletA,
      eventos: comandaCobrada(cid, 1000, 1000),
    });
    const cobro = r.rechazados.find((x) => x.razon === 'pagos_no_cuadran');
    expect(cobro).toBeDefined();

    // La comanda NO quedó cobrada.
    const filas = await app.db.execute(sql`SELECT estado FROM comanda WHERE id = ${cid}`);
    expect((filas as unknown as { estado: string }[])[0]?.estado).not.toBe('cobrada');
  });
});
