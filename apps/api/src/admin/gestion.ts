// Gestión del administrador: catálogo (RF-D), usuarios (RF-C), sucursales (RF-B).
// Todo requiere rol administrador. Las bajas son LÓGICAS (activo=false): el
// historial que referencia a lo dado de baja permanece intacto (RF-C-3, RF-D-5).
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hashSecreto, validarPin } from '@lena/auth';
import { EsquemaEvento, aPesos, formatearHlc } from '@lena/shared';
import { categoria, comanda, dispositivo, producto, productoPrecioHistorial, sucursal, usuario } from '@lena/db';
import type { Db } from '../db';
import { requiereRol } from '../auth/middleware';
import { procesarPush } from '../sync/push';

const soloAdmin = { preHandler: requiereRol('administrador') };
const centavos = z.number().int().nonnegative();

export function registrarRutasGestion(app: FastifyInstance, db: Db): void {
  // ── Productos (RF-D-1/2/5) ──
  app.post('/admin/productos', soloAdmin, async (req, reply) => {
    const p = z
      .object({
        categoriaId: z.string().uuid(),
        nombre: z.string().trim().min(1),
        descripcion: z.string().trim().optional(),
        precio: centavos,
      })
      .safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'peticion_invalida' });
    const [prod] = await db
      .insert(producto)
      .values({
        id: randomUUID(),
        categoriaId: p.data.categoriaId,
        nombre: p.data.nombre,
        descripcion: p.data.descripcion ?? null,
        precioBase: aPesos(p.data.precio),
      })
      .returning({ id: producto.id });
    return { id: prod?.id };
  });

  app.patch<{ Params: { id: string } }>('/admin/productos/:id', soloAdmin, async (req, reply) => {
    const p = z
      .object({
        nombre: z.string().trim().min(1).optional(),
        descripcion: z.string().trim().optional(),
        categoriaId: z.string().uuid().optional(),
        activo: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'peticion_invalida' });
    await db
      .update(producto)
      .set({
        ...(p.data.nombre !== undefined ? { nombre: p.data.nombre } : {}),
        ...(p.data.descripcion !== undefined ? { descripcion: p.data.descripcion } : {}),
        ...(p.data.categoriaId !== undefined ? { categoriaId: p.data.categoriaId } : {}),
        ...(p.data.activo !== undefined ? { activo: p.data.activo } : {}),
        updatedAt: new Date(),
      })
      .where(eq(producto.id, req.params.id));
    return { ok: true };
  });

  // RF-D-3/D-4: cambiar el precio DEJA registro (autor, antes, después). El
  // cambio aplica solo a comandas futuras: las viejas guardan snapshot (ADR-006).
  app.patch<{ Params: { id: string } }>('/admin/productos/:id/precio', soloAdmin, async (req, reply) => {
    const p = z.object({ precio: centavos }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'peticion_invalida' });
    const [actual] = await db
      .select({ precio: producto.precioBase })
      .from(producto)
      .where(eq(producto.id, req.params.id))
      .limit(1);
    if (!actual) return reply.code(404).send({ error: 'no_encontrado' });

    await db.transaction(async (tx) => {
      await tx.insert(productoPrecioHistorial).values({
        id: randomUUID(),
        productoId: req.params.id,
        precioAnterior: actual.precio,
        precioNuevo: aPesos(p.data.precio),
        actorId: req.sesion?.usuarioId as string,
      });
      await tx
        .update(producto)
        .set({ precioBase: aPesos(p.data.precio), updatedAt: new Date() })
        .where(eq(producto.id, req.params.id));
    });
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/admin/productos/:id/precios', soloAdmin, async (req) => {
    return db
      .select()
      .from(productoPrecioHistorial)
      .where(eq(productoPrecioHistorial.productoId, req.params.id))
      .orderBy(productoPrecioHistorial.createdAt);
  });

  // ── Categorías (RF-D-6) ──
  app.post('/admin/categorias', soloAdmin, async (req, reply) => {
    const p = z.object({ nombre: z.string().trim().min(1), orden: z.number().int().default(0) }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'peticion_invalida' });
    const [c] = await db
      .insert(categoria)
      .values({ id: randomUUID(), nombre: p.data.nombre, orden: p.data.orden })
      .returning({ id: categoria.id });
    return { id: c?.id };
  });

  app.patch<{ Params: { id: string } }>('/admin/categorias/:id', soloAdmin, async (req, reply) => {
    const p = z
      .object({
        nombre: z.string().trim().min(1).optional(),
        orden: z.number().int().optional(),
        activo: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'peticion_invalida' });
    await db.update(categoria).set(p.data).where(eq(categoria.id, req.params.id));
    return { ok: true };
  });

  // ── Usuarios (RF-C-1/2/3) ──
  app.get('/admin/usuarios', soloAdmin, async () => {
    return db
      .select({
        id: usuario.id,
        nombre: usuario.nombre,
        rol: usuario.rol,
        sucursalId: usuario.sucursalId,
        activo: usuario.activo,
      })
      .from(usuario);
  });

  app.post('/admin/usuarios', soloAdmin, async (req, reply) => {
    const p = z
      .object({
        nombre: z.string().trim().min(1),
        rol: z.enum(['mesero', 'cocina']), // el admin no crea otros admin por aquí
        sucursalId: z.string().uuid(),
        pin: z.string(),
      })
      .safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'peticion_invalida' });
    const val = validarPin(p.data.pin);
    if (!val.ok) return reply.code(400).send({ error: 'pin_invalido', detalle: val.motivo });
    const [u] = await db
      .insert(usuario)
      .values({
        id: randomUUID(),
        nombre: p.data.nombre,
        rol: p.data.rol,
        sucursalId: p.data.sucursalId,
        pinHash: await hashSecreto(p.data.pin),
      })
      .returning({ id: usuario.id });
    return { id: u?.id };
  });

  app.patch<{ Params: { id: string } }>('/admin/usuarios/:id', soloAdmin, async (req, reply) => {
    const p = z
      .object({ nombre: z.string().trim().min(1).optional(), activo: z.boolean().optional() })
      .safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'peticion_invalida' });
    await db
      .update(usuario)
      .set({ ...p.data, updatedAt: new Date() })
      .where(eq(usuario.id, req.params.id));
    return { ok: true };
  });

  // RF-C-2: reasignar PIN. Invalida sesiones activas del usuario (RS-A-11).
  app.patch<{ Params: { id: string } }>('/admin/usuarios/:id/pin', soloAdmin, async (req, reply) => {
    const p = z.object({ pin: z.string() }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'peticion_invalida' });
    const val = validarPin(p.data.pin);
    if (!val.ok) return reply.code(400).send({ error: 'pin_invalido', detalle: val.motivo });
    await db
      .update(usuario)
      .set({ pinHash: await hashSecreto(p.data.pin), updatedAt: new Date() })
      .where(eq(usuario.id, req.params.id));
    return { ok: true };
  });

  // ── Sucursales (RF-B-1/2/3/4) ──
  app.get('/admin/sucursales', soloAdmin, async () => {
    return db.select().from(sucursal);
  });

  app.post('/admin/sucursales', soloAdmin, async (req, reply) => {
    const p = z
      .object({ nombre: z.string().trim().min(1), direccion: z.string().trim().optional() })
      .safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'peticion_invalida' });
    const [s] = await db
      .insert(sucursal)
      .values({ id: randomUUID(), nombre: p.data.nombre, direccion: p.data.direccion ?? null })
      .returning({ id: sucursal.id });
    return { id: s?.id };
  });

  app.patch<{ Params: { id: string } }>('/admin/sucursales/:id', soloAdmin, async (req, reply) => {
    const p = z
      .object({
        nombre: z.string().trim().min(1).optional(),
        direccion: z.string().trim().optional(),
        activo: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'peticion_invalida' });
    await db
      .update(sucursal)
      .set({ ...p.data, updatedAt: new Date() })
      .where(eq(sucursal.id, req.params.id));
    return { ok: true };
  });

  // ── Reabrir comanda cobrada (RF-G-8) ──
  // Solo el admin. Emite comanda_reabierta al log (con motivo y autor): la
  // reapertura también queda registrada, no es una edición silenciosa.
  app.post<{ Params: { id: string } }>('/admin/comandas/:id/reabrir', soloAdmin, async (req, reply) => {
    const p = z.object({ motivo: z.string().trim().min(1) }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'peticion_invalida' });
    const [c] = await db
      .select({ sucursalId: comanda.sucursalId, estado: comanda.estado })
      .from(comanda)
      .where(eq(comanda.id, req.params.id))
      .limit(1);
    if (!c) return reply.code(404).send({ error: 'no_encontrada' });
    if (c.estado !== 'cobrada') return reply.code(409).send({ error: 'no_esta_cobrada' });
    // El admin no tiene dispositivo propio; se usa uno activo de la sucursal
    // para la procedencia. El autor real es el admin (actor_id, rol_actor).
    const [disp] = await db
      .select({ id: dispositivo.id })
      .from(dispositivo)
      .where(and(eq(dispositivo.sucursalId, c.sucursalId), eq(dispositivo.activo, true)))
      .limit(1);
    if (!disp) return reply.code(409).send({ error: 'sin_dispositivo' });

    const evento = EsquemaEvento.parse({
      id: randomUUID(),
      comandaId: req.params.id,
      sucursalId: c.sucursalId,
      actorId: req.sesion?.usuarioId as string,
      rolActor: 'administrador',
      dispositivoId: disp.id,
      hlc: formatearHlc({ fisico: Date.now(), logico: 0, nodo: 'ADMIN' }),
      tsCliente: new Date().toISOString(),
      tipo: 'comanda_reabierta',
      payload: { tipo: 'comanda_reabierta', motivo: p.data.motivo },
    });
    const r = await procesarPush(db, { dispositivoId: disp.id, eventos: [evento] });
    if (r.rechazados.length) return reply.code(409).send({ error: r.rechazados[0]?.razon });
    return { ok: true };
  });
}
