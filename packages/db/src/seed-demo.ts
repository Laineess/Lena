/**
 * Datos simulados de 8 semanas para la DEMO (mostrarle el sistema al cliente).
 *
 *   pnpm db:seed-demo
 *
 * Genera, para la sucursal Centro y los últimos 56 días: comandas cobradas
 * (repartidas por hora y con variación por día de la semana), cancelaciones con
 * merma (para el control antifraude T1), cortes de caja, gastos, y el ciclo de
 * insumos (conteo apertura/cierre + compras) con un consumo derivado que
 * CORRELACIONA con las ventas — así la compra sugerida (RF-M) ya recomienda con
 * confianza. Idempotente: borra los datos operativos y los regenera.
 *
 * ⚠️ Solo desarrollo/demo. Aborta si NODE_ENV=production.
 */
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { config as cargarEnv } from 'dotenv';
import { crearDb } from './index';
import {
  comanda,
  comandaDetalle,
  compraInsumo,
  conteoInsumo,
  corteCaja,
  gasto,
  insumo,
  insumoParametro,
  mermaProducto,
} from './schema/index';

cargarEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
if (process.env.NODE_ENV === 'production') throw new Error('El seed-demo NO se corre en producción.');
const url = process.env.DATABASE_URL;
if (!url) throw new Error('Falta DATABASE_URL.');
const db = crearDb(url);

const SUC = '01930000-0000-7000-8000-000000000001'; // Centro
const ANA = '01930000-0000-7000-8000-000000000011';
const LUIS = '01930000-0000-7000-8000-000000000012';
const uuid = (n: number) => `01930000-0000-7000-8000-0000000${String(n).padStart(5, '0')}`;
const insId = (n: number) => `01930000-0000-7000-8000-0000000f000${n}`;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const ri = (a: number, b: number) => Math.floor(rnd(a, b + 1));
const noise = () => rnd(0.95, 1.05);
const pesos = (n: number) => n.toFixed(2);
const cant = (n: number) => n.toFixed(3);
const pick = <T>(xs: T[]): T => xs[ri(0, xs.length - 1)] as T;

// grupo: para mapear la venta al insumo que consume.
const PRODUCTOS = [
  { id: uuid(200), nombre: 'Pastor', precio: 18, base: 40, grupo: 'pastor' },
  { id: uuid(201), nombre: 'Árabe', precio: 20, base: 18, grupo: 'arabe' },
  { id: uuid(202), nombre: 'Suadero', precio: 18, base: 25, grupo: 'res' },
  { id: uuid(203), nombre: 'Bistec', precio: 18, base: 20, grupo: 'res' },
  { id: uuid(204), nombre: 'Campechano', precio: 22, base: 15, grupo: 'res' },
  { id: uuid(205), nombre: 'Chorizo', precio: 18, base: 12, grupo: 'res' },
  { id: uuid(206), nombre: 'Refresco', precio: 25, base: 30, grupo: 'refresco' },
  { id: uuid(207), nombre: 'Agua de horchata', precio: 30, base: 8, grupo: 'otro' },
  { id: uuid(208), nombre: 'Agua natural', precio: 15, base: 12, grupo: 'otro' },
  { id: uuid(209), nombre: 'Queso fundido', precio: 45, base: 5, grupo: 'otro' },
  { id: uuid(210), nombre: 'Orden de cebollitas', precio: 20, base: 8, grupo: 'otro' },
] as const;
const TACO = new Set(['pastor', 'arabe', 'res']);

const INSUMOS = [
  { id: insId(1), nombre: 'Carne al pastor', unidad: 'kg', costo: 180, seg: 5 },
  { id: insId(2), nombre: 'Carne árabe', unidad: 'kg', costo: 200, seg: 3 },
  { id: insId(3), nombre: 'Carne de res', unidad: 'kg', costo: 160, seg: 5 },
  { id: insId(4), nombre: 'Tortilla', unidad: 'kg', costo: 22, seg: 3 },
  { id: insId(5), nombre: 'Cebolla', unidad: 'kg', costo: 25, seg: 1.5 },
  { id: insId(6), nombre: 'Refresco (botella)', unidad: 'pza', costo: 12, seg: 24 },
] as const;
// factor por día de la semana (0=domingo): fines más ocupados.
const DOW = [1.3, 0.8, 0.85, 0.9, 1.0, 1.35, 1.55];

async function insertar<T>(tabla: unknown, filas: T[]) {
  for (let i = 0; i < filas.length; i += 500) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db.insert as any)(tabla).values(filas.slice(i, i + 500));
  }
}

console.log('Sembrando 8 semanas de demo (Centro)…');

// Limpia lo operativo (deja la estructura: sucursales, usuarios, productos, mesas).
await db.execute(sql`
  TRUNCATE comanda_evento, comanda_detalle, merma_producto, pago, retiro_caja, comanda, corte_caja,
           conteo_insumo, compra_insumo, merma, gasto, insumo_parametro
  RESTART IDENTITY CASCADE`);

// Insumos + parámetros de compra (días de entrega y stock de seguridad).
await db
  .insert(insumo)
  .values(INSUMOS.map((i) => ({ id: i.id, nombre: i.nombre, unidad: i.unidad })))
  .onConflictDoNothing();
await db
  .insert(insumoParametro)
  .values(INSUMOS.map((i) => ({ insumoId: i.id, sucursalId: SUC, stockSeguridad: cant(i.seg), diasEntrega: 2 })));

const cortes: (typeof corteCaja.$inferInsert)[] = [];
const comandas: (typeof comanda.$inferInsert)[] = [];
const detalles: (typeof comandaDetalle.$inferInsert)[] = [];
const mermas: (typeof mermaProducto.$inferInsert)[] = [];
const conteos: (typeof conteoInsumo.$inferInsert)[] = [];
const compras: (typeof compraInsumo.$inferInsert)[] = [];
const gastos: (typeof gasto.$inferInsert)[] = [];

const hoy = new Date();
for (let d = 55; d >= 0; d--) {
  const dia = new Date(hoy.getTime() - d * 86_400_000);
  const fecha = dia.toISOString().slice(0, 10);
  const factor = DOW[dia.getUTCDay()] as number;

  // Unidades vendidas por producto y acumulados por grupo.
  const gruposUnid: Record<string, number> = { pastor: 0, arabe: 0, res: 0, refresco: 0, taco: 0 };
  const items: { p: (typeof PRODUCTOS)[number] }[] = [];
  for (const p of PRODUCTOS) {
    const u = Math.max(0, Math.round(p.base * factor * noise()));
    gruposUnid[p.grupo] = (gruposUnid[p.grupo] ?? 0) + u;
    if (TACO.has(p.grupo)) gruposUnid.taco = (gruposUnid.taco ?? 0) + u;
    for (let k = 0; k < u; k++) items.push({ p });
  }
  // Baraja y reparte en comandas de 5–12 items.
  items.sort(() => Math.random() - 0.5);
  const corteId = randomUUID();
  let ventaDia = 0;
  let idx = 0;
  while (idx < items.length) {
    const n = Math.min(items.length - idx, ri(5, 12));
    const grupo = items.slice(idx, idx + n);
    idx += n;
    const cid = randomUUID();
    const mesero = Math.random() < 0.5 ? ANA : LUIS;
    const hh = String(ri(13, 22)).padStart(2, '0');
    const mm = String(ri(0, 59)).padStart(2, '0');
    const at = `${fecha}T${hh}:${mm}:00-06:00`;
    // Agrupa por producto → líneas con cantidad.
    const porProd = new Map<string, { p: (typeof PRODUCTOS)[number]; c: number }>();
    for (const it of grupo) {
      const e = porProd.get(it.p.id) ?? { p: it.p, c: 0 };
      e.c += 1;
      porProd.set(it.p.id, e);
    }
    let total = 0;
    for (const { p, c } of porProd.values()) {
      total += p.precio * c;
      detalles.push({
        id: randomUUID(),
        comandaId: cid,
        productoId: p.id,
        nombreProducto: p.nombre,
        precioUnitario: pesos(p.precio),
        cantidad: c,
        estado: 'lista',
        enviadaAt: new Date(at),
        listaAt: new Date(at),
      });
    }
    ventaDia += total;
    comandas.push({
      id: cid,
      sucursalId: SUC,
      corteCajaId: corteId,
      tipoServicio: 'para_llevar',
      meseroId: mesero,
      estado: 'cobrada',
      total: pesos(total),
      abiertaAt: new Date(at),
      cerradaAt: new Date(at),
    });
  }

  // Cancelaciones con merma (bias a Luis → dispara el control T1).
  const numCancel = Math.random() < 0.6 ? ri(1, 2) : 0;
  for (let c = 0; c < numCancel; c++) {
    const p = pick(PRODUCTOS.filter((x) => TACO.has(x.grupo)) as unknown as (typeof PRODUCTOS)[number][]);
    const mesero = Math.random() < 0.72 ? LUIS : ANA;
    const qty = ri(1, 3);
    const cid = randomUUID();
    const did = randomUUID();
    const at = `${fecha}T${String(ri(13, 22)).padStart(2, '0')}:15:00-06:00`;
    comandas.push({
      id: cid,
      sucursalId: SUC,
      corteCajaId: corteId,
      tipoServicio: 'para_llevar',
      meseroId: mesero,
      estado: 'cancelada',
      total: '0',
      motivoCancelacion: pick(['el cliente se fue', 'se equivocaron de orden', 'ya no lo quería']),
      abiertaAt: new Date(at),
      cerradaAt: new Date(at),
    });
    detalles.push({
      id: did,
      comandaId: cid,
      productoId: p.id,
      nombreProducto: p.nombre,
      precioUnitario: pesos(p.precio),
      cantidad: qty,
      estado: 'cancelada',
      enviadaAt: new Date(at),
    });
    mermas.push({
      id: randomUUID(),
      sucursalId: SUC,
      comandaId: cid,
      detalleId: did,
      productoId: p.id,
      nombreProducto: p.nombre,
      cantidad: qty,
      costoEstimado: pesos(p.precio * qty),
      estadoAlCancelar: 'lista',
      motivo: 'ya preparado, se tiró',
      actorId: mesero,
      fecha,
    });
  }

  // Corte del día: ~60% efectivo, 35% tarjeta, 5% transferencia; diferencia chica.
  const efectivo = Math.round(ventaDia * 0.6);
  const tarjeta = Math.round(ventaDia * 0.35);
  const transfer = Math.round(ventaDia * 0.05);
  const esperado = 1000 + efectivo;
  const diferencia = Math.random() < 0.75 ? 0 : ri(-40, 40);
  cortes.push({
    id: corteId,
    sucursalId: SUC,
    estado: 'cerrado',
    fondoInicial: '1000.00',
    esperadoEfectivo: pesos(esperado),
    contadoEfectivo: pesos(esperado + diferencia),
    diferencia: pesos(diferencia),
    totalTarjeta: pesos(tarjeta),
    totalTransferencia: pesos(transfer),
    ...(Math.abs(diferencia) > 20 ? { motivoDiferencia: 'error de cambio' } : {}),
    abiertoPor: ANA,
    abiertoAt: new Date(`${fecha}T12:00:00-06:00`),
    cerradoPor: ANA,
    cerradoAt: new Date(`${fecha}T23:00:00-06:00`),
  });

  // Consumo de insumo derivado de la venta (con ruido) → conteos apertura/cierre.
  const consumoDe: Record<string, number> = {
    [insId(1)]: (gruposUnid.pastor ?? 0) * 0.09 * noise(),
    [insId(2)]: (gruposUnid.arabe ?? 0) * 0.1 * noise(),
    [insId(3)]: (gruposUnid.res ?? 0) * 0.09 * noise(),
    [insId(4)]: (gruposUnid.taco ?? 0) * 0.03 * noise(),
    [insId(5)]: (gruposUnid.taco ?? 0) * 0.012 * noise(),
    [insId(6)]: gruposUnid.refresco ?? 0,
  };
  const compraDia = dia.getUTCDay() === 1 || dia.getUTCDay() === 4; // lun y jue surten
  for (const ins of INSUMOS) {
    const consumo = consumoDe[ins.id] ?? 0;
    const comprado = compraDia ? Math.round(consumo * 3.2 * 1000) / 1000 : 0;
    const apertura = Math.round((consumo * 1.3 + (ins.unidad === 'pza' ? 6 : 2)) * 1000) / 1000;
    // El último día queda con stock BAJO (a punto de reordenar): así la compra
    // sugerida muestra números > 0 para la demo.
    const cierre =
      d === 0
        ? Math.round(consumo * 0.35 * 1000) / 1000
        : Math.round((apertura + comprado - consumo) * 1000) / 1000;
    conteos.push({ id: randomUUID(), sucursalId: SUC, insumoId: ins.id, tipo: 'apertura', cantidad: cant(apertura), fecha, actorId: ANA });
    conteos.push({ id: randomUUID(), sucursalId: SUC, insumoId: ins.id, tipo: 'cierre', cantidad: cant(cierre), fecha, actorId: ANA });
    if (comprado > 0) {
      const costo = comprado * ins.costo;
      compras.push({ id: randomUUID(), sucursalId: SUC, insumoId: ins.id, cantidad: cant(comprado), costoTotal: pesos(costo), fecha, actorId: ANA });
      gastos.push({ id: randomUUID(), sucursalId: SUC, categoria: 'insumo', concepto: `Compra: ${ins.nombre}`, monto: pesos(costo), fecha, actorId: ANA });
    }
  }

  // Gastos fijos: sueldos y servicios los lunes; renta el día 1 del mes.
  if (dia.getUTCDay() === 1) {
    gastos.push({ id: randomUUID(), sucursalId: SUC, categoria: 'sueldo', concepto: 'Sueldos de la semana', monto: '3500.00', fecha, actorId: ANA });
    gastos.push({ id: randomUUID(), sucursalId: SUC, categoria: 'servicio', concepto: 'Luz y gas', monto: '700.00', fecha, actorId: ANA });
  }
  if (fecha.slice(8, 10) === '01') {
    gastos.push({ id: randomUUID(), sucursalId: SUC, categoria: 'renta', concepto: 'Renta del local', monto: '12000.00', fecha, actorId: ANA });
  }
}

await insertar(corteCaja, cortes);
await insertar(comanda, comandas);
await insertar(comandaDetalle, detalles);
await insertar(mermaProducto, mermas);
await insertar(conteoInsumo, conteos);
await insertar(compraInsumo, compras);
await insertar(gasto, gastos);

console.log(`✓ Demo lista (56 días, Centro):`);
console.log(`  ${comandas.length} comandas · ${detalles.length} líneas · ${mermas.length} cancelaciones con merma`);
console.log(`  ${cortes.length} cortes · ${conteos.length} conteos · ${compras.length} compras de insumo · ${gastos.length} gastos`);
console.log('  Entra como Admin Centro (admin@lena.local) o dueño y filtra Centro.');
process.exit(0);
