// Fase 2 (parte A) — Insumos, proveedores, compras, conteos y merma de insumo
// (RF-L). El catálogo de insumos y proveedores es del negocio (global); las
// operaciones diarias (compra, conteo, merma, consumo) van por sucursal, con el
// mismo scoping que el resto de gestión (RS-Z-7). Sin recetas: el consumo se
// deriva por conteo diferencial (vista consumo_diario_insumo).
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { aCentavos, aPesos } from '@lena/shared';
import { compraInsumo, conteoInsumo, corteCaja, gasto, insumo, insumoParametro, merma, proveedor, retiroCaja } from '@lena/db';
import type { Db } from '../db';
import { requiereRol } from '../auth/middleware';
import { esSuperadmin, sucursalScope } from '../admin/scope';
import { resumirConsumo } from './consumo';
import type { FilaConsumo } from './consumo';
import { pronosticoHorizonte, recomendarCompra } from './compra';

const soloAdmin = { preHandler: requiereRol('superadmin', 'administrador') };
const UNIDADES = ['kg', 'g', 'l', 'ml', 'pza', 'caja', 'manojo'] as const;
const cantidad = z.number().positive();
const centavos = z.number().int().nonnegative();

// Rango [desde, hasta], por defecto hoy (zona MX).
function rango(req: { query: unknown }): { desde: string; hasta: string } {
  const p = z.object({ desde: z.string().optional(), hasta: z.string().optional() }).parse(req.query ?? {});
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
  return { desde: p.desde ?? hoy, hasta: p.hasta ?? hoy };
}

export function registrarRutasInsumos(app: FastifyInstance, db: Db): void {
  // ── Insumos (catálogo global, RF-L-1) ──
  app.get('/admin/insumos', soloAdmin, async () => {
    return db.select().from(insumo).orderBy(asc(insumo.nombre));
  });
  app.post('/admin/insumos', soloAdmin, async (req, reply) => {
    const p = z.object({ nombre: z.string().trim().min(1), unidad: z.enum(UNIDADES) }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'peticion_invalida' });
    const [i] = await db
      .insert(insumo)
      .values({ id: randomUUID(), nombre: p.data.nombre, unidad: p.data.unidad })
      .returning({ id: insumo.id });
    return { id: i?.id };
  });
  app.patch<{ Params: { id: string } }>('/admin/insumos/:id', soloAdmin, async (req, reply) => {
    const p = z
      .object({ nombre: z.string().trim().min(1).optional(), unidad: z.enum(UNIDADES).optional(), activo: z.boolean().optional() })
      .safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'peticion_invalida' });
    await db.update(insumo).set(p.data).where(eq(insumo.id, req.params.id));
    return { ok: true };
  });

  // ── Proveedores (global, RF-L-2) ──
  app.get('/admin/proveedores', soloAdmin, async () => {
    return db.select().from(proveedor).orderBy(asc(proveedor.nombre));
  });
  app.post('/admin/proveedores', soloAdmin, async (req, reply) => {
    const p = z.object({ nombre: z.string().trim().min(1), contacto: z.string().trim().optional() }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'peticion_invalida' });
    const [pr] = await db
      .insert(proveedor)
      .values({ id: randomUUID(), nombre: p.data.nombre, contacto: p.data.contacto ?? null })
      .returning({ id: proveedor.id });
    return { id: pr?.id };
  });
  app.patch<{ Params: { id: string } }>('/admin/proveedores/:id', soloAdmin, async (req, reply) => {
    const p = z
      .object({ nombre: z.string().trim().min(1).optional(), contacto: z.string().trim().optional(), activo: z.boolean().optional() })
      .safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'peticion_invalida' });
    await db.update(proveedor).set(p.data).where(eq(proveedor.id, req.params.id));
    return { ok: true };
  });

  // ── Compras / surtido (por sucursal, RF-L-2) ──
  app.get('/admin/compras', soloAdmin, async (req) => {
    const { desde, hasta } = rango(req);
    const suc = sucursalScope(req, (req.query as { sucursalId?: string })?.sucursalId);
    const filas = await db
      .select({
        id: compraInsumo.id,
        insumoId: compraInsumo.insumoId,
        insumo: insumo.nombre,
        unidad: insumo.unidad,
        cantidad: compraInsumo.cantidad,
        costoTotal: compraInsumo.costoTotal,
        fecha: compraInsumo.fecha,
      })
      .from(compraInsumo)
      .innerJoin(insumo, eq(insumo.id, compraInsumo.insumoId))
      .where(
        and(
          gte(compraInsumo.fecha, desde),
          lte(compraInsumo.fecha, hasta),
          suc ? eq(compraInsumo.sucursalId, suc) : undefined,
        ),
      )
      .orderBy(desc(compraInsumo.fecha));
    return filas.map((f) => ({ ...f, cantidad: Number(f.cantidad), costoTotal: aCentavos(f.costoTotal) }));
  });
  // Una compra de insumo es UN registro con TRES efectos (compra unificada):
  //  1. entra al inventario (consumo/compra sugerida),
  //  2. cuenta como gasto (categoría insumo → balance, RF-I-4/5),
  //  3. si se pagó en efectivo de la caja, es un retiro que baja el esperado
  //     del corte del turno abierto (para que cuadre, no marque faltante).
  app.post('/admin/compras', soloAdmin, async (req, reply) => {
    const p = z
      .object({
        insumoId: z.string().uuid(),
        proveedorId: z.string().uuid().optional(),
        cantidad,
        costoTotal: centavos,
        fecha: z.string(),
        pagadoEnEfectivo: z.boolean().optional(),
        sucursalId: z.string().uuid().optional(),
      })
      .safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'peticion_invalida' });
    const sucursalId = esSuperadmin(req) ? p.data.sucursalId : req.sesion?.sucursalId;
    if (!sucursalId) return reply.code(400).send({ error: 'sucursal_requerida' });
    const actorId = req.sesion?.usuarioId as string;
    const [ins] = await db.select({ nombre: insumo.nombre }).from(insumo).where(eq(insumo.id, p.data.insumoId)).limit(1);
    const concepto = `Compra: ${ins?.nombre ?? 'insumo'}`;

    const idCompra = await db.transaction(async (tx) => {
      const [c] = await tx
        .insert(compraInsumo)
        .values({
          id: randomUUID(),
          sucursalId,
          insumoId: p.data.insumoId,
          proveedorId: p.data.proveedorId ?? null,
          cantidad: String(p.data.cantidad),
          costoTotal: aPesos(p.data.costoTotal),
          fecha: p.data.fecha,
          actorId,
        })
        .returning({ id: compraInsumo.id });
      // Gasto (siempre): la compra es dinero que salió del negocio.
      const [g] = await tx
        .insert(gasto)
        .values({ id: randomUUID(), sucursalId, categoria: 'insumo', concepto, monto: aPesos(p.data.costoTotal), fecha: p.data.fecha, actorId })
        .returning({ id: gasto.id });
      // Retiro (solo si se pagó en efectivo y hay un turno abierto).
      if (p.data.pagadoEnEfectivo) {
        const [turno] = await tx
          .select({ id: corteCaja.id })
          .from(corteCaja)
          .where(and(eq(corteCaja.sucursalId, sucursalId), eq(corteCaja.estado, 'abierto')))
          .limit(1);
        if (turno) {
          await tx.insert(retiroCaja).values({
            id: randomUUID(),
            corteCajaId: turno.id,
            sucursalId,
            monto: aPesos(p.data.costoTotal),
            motivo: concepto,
            gastoId: g?.id ?? null,
            actorId,
          });
        }
      }
      return c?.id;
    });
    return { id: idCompra };
  });

  // ── Conteos de apertura/cierre (por sucursal, RF-L-3/4) ──
  app.get('/admin/conteos', soloAdmin, async (req) => {
    const suc = sucursalScope(req, (req.query as { sucursalId?: string })?.sucursalId);
    const fecha =
      (req.query as { fecha?: string })?.fecha ??
      new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
    const filas = await db
      .select({
        id: conteoInsumo.id,
        insumoId: conteoInsumo.insumoId,
        tipo: conteoInsumo.tipo,
        cantidad: conteoInsumo.cantidad,
        fecha: conteoInsumo.fecha,
      })
      .from(conteoInsumo)
      .where(and(eq(conteoInsumo.fecha, fecha), suc ? eq(conteoInsumo.sucursalId, suc) : undefined));
    return filas.map((f) => ({ ...f, cantidad: Number(f.cantidad) }));
  });
  // Un solo conteo por (sucursal, insumo, tipo, día): si se recaptura, se pisa.
  app.post('/admin/conteos', soloAdmin, async (req, reply) => {
    const p = z
      .object({
        insumoId: z.string().uuid(),
        tipo: z.enum(['apertura', 'cierre']),
        cantidad: z.number().nonnegative(),
        fecha: z.string(),
        sucursalId: z.string().uuid().optional(),
      })
      .safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'peticion_invalida' });
    const sucursalId = esSuperadmin(req) ? p.data.sucursalId : req.sesion?.sucursalId;
    if (!sucursalId) return reply.code(400).send({ error: 'sucursal_requerida' });
    await db
      .insert(conteoInsumo)
      .values({
        id: randomUUID(),
        sucursalId,
        insumoId: p.data.insumoId,
        tipo: p.data.tipo,
        cantidad: String(p.data.cantidad),
        fecha: p.data.fecha,
        actorId: req.sesion?.usuarioId as string,
      })
      .onConflictDoUpdate({
        target: [conteoInsumo.sucursalId, conteoInsumo.insumoId, conteoInsumo.tipo, conteoInsumo.fecha],
        set: { cantidad: String(p.data.cantidad), actorId: req.sesion?.usuarioId as string },
      });
    return { ok: true };
  });

  // ── Merma de insumo crudo (por sucursal, RF-L-6) ──
  app.get('/admin/merma-insumo', soloAdmin, async (req) => {
    const { desde, hasta } = rango(req);
    const suc = sucursalScope(req, (req.query as { sucursalId?: string })?.sucursalId);
    const filas = await db
      .select({
        id: merma.id,
        insumoId: merma.insumoId,
        insumo: insumo.nombre,
        unidad: insumo.unidad,
        cantidad: merma.cantidad,
        motivo: merma.motivo,
        fecha: merma.fecha,
      })
      .from(merma)
      .innerJoin(insumo, eq(insumo.id, merma.insumoId))
      .where(and(gte(merma.fecha, desde), lte(merma.fecha, hasta), suc ? eq(merma.sucursalId, suc) : undefined))
      .orderBy(desc(merma.fecha));
    return filas.map((f) => ({ ...f, cantidad: Number(f.cantidad) }));
  });
  app.post('/admin/merma-insumo', soloAdmin, async (req, reply) => {
    const p = z
      .object({
        insumoId: z.string().uuid(),
        cantidad,
        motivo: z.string().trim().min(1),
        fecha: z.string(),
        sucursalId: z.string().uuid().optional(),
      })
      .safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'peticion_invalida' });
    const sucursalId = esSuperadmin(req) ? p.data.sucursalId : req.sesion?.sucursalId;
    if (!sucursalId) return reply.code(400).send({ error: 'sucursal_requerida' });
    const [m] = await db
      .insert(merma)
      .values({
        id: randomUUID(),
        sucursalId,
        insumoId: p.data.insumoId,
        cantidad: String(p.data.cantidad),
        motivo: p.data.motivo,
        fecha: p.data.fecha,
        actorId: req.sesion?.usuarioId as string,
      })
      .returning({ id: merma.id });
    return { id: m?.id };
  });

  // ── Consumo derivado (vista, RF-L-5/7) ──
  // consumo_del_día = apertura + compras − cierre. La vista ya lo calcula.
  app.get('/admin/consumo', soloAdmin, async (req) => {
    const { desde, hasta } = rango(req);
    const suc = sucursalScope(req, (req.query as { sucursalId?: string })?.sucursalId);
    const filas = (await db.execute(sql`
      SELECT c.insumo_id, i.nombre, i.unidad, c.consumo, c.merma_reportada
      FROM consumo_diario_insumo c
      JOIN insumo i ON i.id = c.insumo_id
      WHERE c.fecha BETWEEN ${desde} AND ${hasta}
        ${suc ? sql`AND c.sucursal_id = ${suc}` : sql``}
    `)) as unknown as { insumo_id: string; nombre: string; unidad: string; consumo: string; merma_reportada: string }[];
    const mapeadas: FilaConsumo[] = filas.map((f) => ({
      insumoId: f.insumo_id,
      nombre: f.nombre,
      unidad: f.unidad,
      consumo: Number(f.consumo),
      mermaReportada: Number(f.merma_reportada),
    }));
    return resumirConsumo(mapeadas);
  });

  // ── Parámetros de compra por insumo (RF-M-4) ──
  // Stock de seguridad y días de entrega, por sucursal.
  app.put<{ Params: { id: string } }>('/admin/insumos/:id/parametro', soloAdmin, async (req, reply) => {
    const p = z
      .object({ stockSeguridad: z.number().nonnegative(), diasEntrega: z.number().int().positive(), sucursalId: z.string().uuid().optional() })
      .safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'peticion_invalida' });
    const sucursalId = esSuperadmin(req) ? p.data.sucursalId : req.sesion?.sucursalId;
    if (!sucursalId) return reply.code(400).send({ error: 'sucursal_requerida' });
    await db
      .insert(insumoParametro)
      .values({ insumoId: req.params.id, sucursalId, stockSeguridad: String(p.data.stockSeguridad), diasEntrega: p.data.diasEntrega })
      .onConflictDoUpdate({
        target: [insumoParametro.insumoId, insumoParametro.sucursalId],
        set: { stockSeguridad: String(p.data.stockSeguridad), diasEntrega: p.data.diasEntrega },
      });
    return { ok: true };
  });

  // ── Compra sugerida (RF-M) ──
  // Por insumo: ratio insumo↔venta (regr_slope, RF-M-1), pronóstico por día de
  // la semana (RF-M-2), recomendación (RF-M-3) con merma de producto (RF-M-7) y
  // aviso si el historial es pobre (RF-M-6). Expone los datos base (RF-M-5).
  app.get('/admin/compra-sugerida', soloAdmin, async (req, reply) => {
    const suc = sucursalScope(req, (req.query as { sucursalId?: string })?.sucursalId);
    if (!suc) return reply.code(400).send({ error: 'sucursal_requerida' });
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());

    // Ventas por día → promedio por día de la semana (pronóstico, RF-M-2).
    const ventas = (await db.execute(sql`
      SELECT extract(dow FROM (c.cerrada_at AT TIME ZONE 'America/Mexico_City')::date)::int AS dow,
        (c.cerrada_at AT TIME ZONE 'America/Mexico_City')::date AS fecha, SUM(d.cantidad)::float AS unidades
      FROM comanda c JOIN comanda_detalle d ON d.comanda_id = c.id
      WHERE c.sucursal_id = ${suc} AND c.estado = 'cobrada' AND d.estado <> 'cancelada'
      GROUP BY 1, 2
    `)) as unknown as { dow: number; fecha: string; unidades: number }[];
    const porDow = new Map<number, number[]>();
    for (const v of ventas) {
      if (!porDow.has(v.dow)) porDow.set(v.dow, []);
      (porDow.get(v.dow) as number[]).push(v.unidades);
    }
    const promPorDow: Record<number, number> = {};
    for (const [dow, arr] of porDow) promPorDow[dow] = arr.reduce((a, b) => a + b, 0) / arr.length;

    // Ratio insumo↔venta con regr_slope (RF-M-1); todos los insumos activos.
    const ratios = (await db.execute(sql`
      SELECT i.id, i.nombre, i.unidad, regr_slope(dc.consumo, dv.unidades) AS ratio, count(dc.fecha)::int AS dias
      FROM insumo i
      LEFT JOIN consumo_diario_insumo dc ON dc.insumo_id = i.id AND dc.sucursal_id = ${suc}
      LEFT JOIN (
        SELECT (c.cerrada_at AT TIME ZONE 'America/Mexico_City')::date AS fecha, SUM(d.cantidad)::float AS unidades
        FROM comanda c JOIN comanda_detalle d ON d.comanda_id = c.id
        WHERE c.sucursal_id = ${suc} AND c.estado = 'cobrada' AND d.estado <> 'cancelada'
        GROUP BY 1
      ) dv ON dv.fecha = dc.fecha
      WHERE i.activo = true
      GROUP BY i.id, i.nombre, i.unidad
      ORDER BY i.nombre
    `)) as unknown as { id: string; nombre: string; unidad: string; ratio: number | null; dias: number }[];

    // Stock actual = último conteo (prefiere el cierre del día más reciente).
    const stock = (await db.execute(sql`
      SELECT DISTINCT ON (insumo_id) insumo_id, cantidad::float AS cantidad
      FROM conteo_insumo WHERE sucursal_id = ${suc}
      ORDER BY insumo_id, fecha DESC, (tipo = 'cierre') DESC
    `)) as unknown as { insumo_id: string; cantidad: number }[];
    const stockPorInsumo = new Map(stock.map((s) => [s.insumo_id, s.cantidad]));

    const params = (await db.execute(sql`
      SELECT insumo_id, stock_seguridad::float AS ss, dias_entrega AS de
      FROM insumo_parametro WHERE sucursal_id = ${suc}
    `)) as unknown as { insumo_id: string; ss: number; de: number }[];
    const paramPorInsumo = new Map(params.map((p) => [p.insumo_id, { ss: p.ss, de: p.de }]));

    // RF-M-7: merma de producto por cancelación, promedio de unidades por día.
    const [mermaProm] = (await db.execute(sql`
      SELECT coalesce(avg(dia), 0)::float AS prom FROM (
        SELECT fecha, SUM(cantidad)::float AS dia FROM merma_producto WHERE sucursal_id = ${suc} GROUP BY fecha
      ) t
    `)) as unknown as { prom: number }[];
    const mermaPorDia = mermaProm?.prom ?? 0;

    const r3 = (n: number) => Math.round(n * 1000) / 1000;
    return ratios.map((row) => {
      const par = paramPorInsumo.get(row.id) ?? { ss: 0, de: 1 };
      const previstoUnidades = pronosticoHorizonte(promPorDow, hoy, par.de);
      const stockActual = stockPorInsumo.get(row.id) ?? 0;
      const rec = recomendarCompra({
        ratio: row.ratio,
        previstoUnidades,
        mermaUnidades: mermaPorDia * par.de,
        stockActual,
        stockSeguridad: par.ss,
        dias: row.dias,
      });
      return {
        insumoId: row.id,
        nombre: row.nombre,
        unidad: row.unidad,
        ratio: row.ratio === null ? null : r3(row.ratio),
        dias: row.dias,
        stockActual,
        stockSeguridad: par.ss,
        diasEntrega: par.de,
        previstoUnidades: r3(previstoUnidades),
        consumoPrevisto: rec.consumoPrevisto,
        recomendado: rec.recomendado,
        confianza: rec.confianza,
      };
    });
  });
}
