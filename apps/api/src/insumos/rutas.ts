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
import { compraInsumo, conteoInsumo, insumo, merma, proveedor } from '@lena/db';
import type { Db } from '../db';
import { requiereRol } from '../auth/middleware';
import { esSuperadmin, sucursalScope } from '../admin/scope';
import { resumirConsumo } from './consumo';
import type { FilaConsumo } from './consumo';

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
  app.post('/admin/compras', soloAdmin, async (req, reply) => {
    const p = z
      .object({
        insumoId: z.string().uuid(),
        proveedorId: z.string().uuid().optional(),
        cantidad,
        costoTotal: centavos,
        fecha: z.string(),
        sucursalId: z.string().uuid().optional(),
      })
      .safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'peticion_invalida' });
    const sucursalId = esSuperadmin(req) ? p.data.sucursalId : req.sesion?.sucursalId;
    if (!sucursalId) return reply.code(400).send({ error: 'sucursal_requerida' });
    const [c] = await db
      .insert(compraInsumo)
      .values({
        id: randomUUID(),
        sucursalId,
        insumoId: p.data.insumoId,
        proveedorId: p.data.proveedorId ?? null,
        cantidad: String(p.data.cantidad),
        costoTotal: aPesos(p.data.costoTotal),
        fecha: p.data.fecha,
        actorId: req.sesion?.usuarioId as string,
      })
      .returning({ id: compraInsumo.id });
    return { id: c?.id };
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
}
