// Gestión: catálogo (RF-D), usuarios (RF-C), sucursales (RF-B).
// Dos niveles (07 §roles): `soloSuper` (superadmin) para dar de alta sucursales
// y administradores; `soloAdmin` (superadmin o administrador) para el resto,
// donde el administrador queda acotado a SU sucursal (sucursalScope).
// Las bajas son LÓGICAS (activo=false): el historial permanece intacto.
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { hashSecreto, validarPassword, validarPin } from '@lena/auth';
import { EsquemaEvento, aPesos, formatearHlc } from '@lena/shared';
import {
  categoria,
  comanda,
  dispositivo,
  producto,
  productoPrecioHistorial,
  productoPrecioSucursal,
  sucursal,
  usuario,
} from '@lena/db';
import type { Db } from '../db';
import { requiereRol } from '../auth/middleware';
import { esSuperadmin, sucursalScope } from './scope';
import { procesarPush } from '../sync/push';

const soloAdmin = { preHandler: requiereRol('superadmin', 'administrador') };
const soloSuper = { preHandler: requiereRol('superadmin') };
const centavos = z.number().int().nonnegative();

// Clave de sucursal: slug del nombre + sufijo aleatorio si choca. Mayúsculas,
// sin acentos ni espacios. Es lo que el mesero escribe para entrar (RF-B).
function slugSucursal(nombre: string): string {
  // NFD separa el acento de la letra; el filtro alfanumérico se lleva el acento
  // y deja la base ("é" → "e"). Sin NFD, "é" caería entera.
  const s = nombre
    .normalize('NFD')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 8);
  return s || 'SUC';
}

async function generarClave(db: Db, nombre: string): Promise<string> {
  const base = slugSucursal(nombre);
  for (let i = 0; i < 12; i++) {
    const cand = i === 0 ? base : `${base}-${randomUUID().replace(/-/g, '').slice(0, 4).toUpperCase()}`;
    const [ex] = await db.select({ id: sucursal.id }).from(sucursal).where(eq(sucursal.clave, cand)).limit(1);
    if (!ex) return cand;
  }
  return `${base}-${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

// La categoría se escribe por nombre al dar de alta un producto (RF-D-6): si no
// existe, se crea. Así el admin arma su propia organización sin un CRUD aparte.
async function idDeCategoria(db: Db, nombre: string): Promise<string> {
  const n = nombre.trim();
  const [ex] = await db.select({ id: categoria.id }).from(categoria).where(eq(categoria.nombre, n)).limit(1);
  if (ex) return ex.id;
  const [nueva] = await db
    .insert(categoria)
    .values({ id: randomUUID(), nombre: n, orden: 99 })
    .returning({ id: categoria.id });
  return nueva?.id as string;
}

export function registrarRutasGestion(app: FastifyInstance, db: Db): void {
  // ── Productos (RF-D-1/2/5/6) ──
  app.post('/admin/productos', soloAdmin, async (req, reply) => {
    const p = z
      .object({
        categoria: z.string().trim().min(1),
        subcategoria: z.string().trim().optional(),
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
        categoriaId: await idDeCategoria(db, p.data.categoria),
        nombre: p.data.nombre,
        descripcion: p.data.descripcion ?? null,
        subcategoria: p.data.subcategoria ?? null,
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
        categoria: z.string().trim().min(1).optional(),
        subcategoria: z.string().trim().optional(),
        activo: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'peticion_invalida' });
    await db
      .update(producto)
      .set({
        ...(p.data.nombre !== undefined ? { nombre: p.data.nombre } : {}),
        ...(p.data.descripcion !== undefined ? { descripcion: p.data.descripcion } : {}),
        ...(p.data.categoria !== undefined ? { categoriaId: await idDeCategoria(db, p.data.categoria) } : {}),
        ...(p.data.subcategoria !== undefined ? { subcategoria: p.data.subcategoria || null } : {}),
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

  // RF-D-8: precio POR SUCURSAL (override del precio base). El admin lo fija en
  // su sucursal; el superadmin en la que indique. Sin override vale el base.
  app.put<{ Params: { id: string } }>('/admin/productos/:id/precio-sucursal', soloAdmin, async (req, reply) => {
    const p = z.object({ precio: centavos, sucursalId: z.string().uuid().optional() }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'peticion_invalida' });
    const sucursalId = esSuperadmin(req) ? p.data.sucursalId : req.sesion?.sucursalId;
    if (!sucursalId) return reply.code(400).send({ error: 'sucursal_requerida' });
    await db
      .insert(productoPrecioSucursal)
      .values({ productoId: req.params.id, sucursalId, precio: aPesos(p.data.precio) })
      .onConflictDoUpdate({
        target: [productoPrecioSucursal.productoId, productoPrecioSucursal.sucursalId],
        set: { precio: aPesos(p.data.precio), updatedAt: new Date() },
      });
    return { ok: true };
  });

  // Quita el override → el producto vuelve al precio base en esa sucursal.
  app.delete<{ Params: { id: string }; Querystring: { sucursalId?: string } }>(
    '/admin/productos/:id/precio-sucursal',
    soloAdmin,
    async (req, reply) => {
      const sucursalId = esSuperadmin(req) ? req.query.sucursalId : req.sesion?.sucursalId;
      if (!sucursalId) return reply.code(400).send({ error: 'sucursal_requerida' });
      await db
        .delete(productoPrecioSucursal)
        .where(and(eq(productoPrecioSucursal.productoId, req.params.id), eq(productoPrecioSucursal.sucursalId, sucursalId)));
      return { ok: true };
    },
  );

  // ── Categorías y subcategorías (RF-D-6) ──
  // Renombrar una subcategoría (texto libre) en TODO el menú de una vez.
  app.patch('/admin/subcategorias', soloAdmin, async (req, reply) => {
    const p = z.object({ de: z.string().trim().min(1), a: z.string().trim().min(1) }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'peticion_invalida' });
    await db
      .update(producto)
      .set({ subcategoria: p.data.a, updatedAt: new Date() })
      .where(eq(producto.subcategoria, p.data.de));
    return { ok: true };
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
  // El administrador ve solo los de su sucursal; el superadmin, todos (o los de
  // la sucursal que filtre con ?sucursalId).
  app.get('/admin/usuarios', soloAdmin, async (req) => {
    const suc = sucursalScope(req, (req.query as { sucursalId?: string })?.sucursalId);
    return db
      .select({
        id: usuario.id,
        nombre: usuario.nombre,
        rol: usuario.rol,
        sucursalId: usuario.sucursalId,
        activo: usuario.activo,
      })
      .from(usuario)
      .where(suc ? eq(usuario.sucursalId, suc) : undefined);
  });

  // Crea mesero/cocina (PIN). El administrador solo en SU sucursal; el
  // superadmin en cualquiera. Para dar de alta administradores → POST /admin/admins.
  app.post('/admin/usuarios', soloAdmin, async (req, reply) => {
    const p = z
      .object({
        nombre: z.string().trim().min(1),
        rol: z.enum(['mesero', 'cocina']),
        sucursalId: z.string().uuid().optional(),
        pin: z.string(),
      })
      .safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'peticion_invalida' });
    const sucursalId = sucursalScope(req, p.data.sucursalId);
    if (!sucursalId) return reply.code(400).send({ error: 'sucursal_requerida' });
    const val = validarPin(p.data.pin);
    if (!val.ok) return reply.code(400).send({ error: 'pin_invalido', detalle: val.motivo });
    const [u] = await db
      .insert(usuario)
      .values({
        id: randomUUID(),
        nombre: p.data.nombre,
        rol: p.data.rol,
        sucursalId,
        pinHash: await hashSecreto(p.data.pin),
      })
      .returning({ id: usuario.id });
    return { id: u?.id };
  });

  // Alta de administrador de sucursal (email+contraseña). SOLO superadmin.
  app.post('/admin/admins', soloSuper, async (req, reply) => {
    const p = z
      .object({
        nombre: z.string().trim().min(1),
        email: z.string().email(),
        password: z.string(),
        sucursalId: z.string().uuid(),
      })
      .safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'peticion_invalida' });
    const val = validarPassword(p.data.password);
    if (!val.ok) return reply.code(400).send({ error: 'password_invalida', detalle: val.motivo });
    const [u] = await db
      .insert(usuario)
      .values({
        id: randomUUID(),
        nombre: p.data.nombre,
        rol: 'administrador',
        sucursalId: p.data.sucursalId,
        email: p.data.email,
        passwordHash: await hashSecreto(p.data.password),
      })
      .returning({ id: usuario.id });
    return { id: u?.id };
  });

  // Un administrador solo toca usuarios de su sucursal (403 si no).
  async function fueraDeScope(req: FastifyRequest, id: string): Promise<boolean> {
    if (esSuperadmin(req)) return false;
    const [u] = await db.select({ suc: usuario.sucursalId }).from(usuario).where(eq(usuario.id, id)).limit(1);
    return !u || u.suc !== req.sesion?.sucursalId;
  }

  app.patch<{ Params: { id: string } }>('/admin/usuarios/:id', soloAdmin, async (req, reply) => {
    const p = z
      .object({ nombre: z.string().trim().min(1).optional(), activo: z.boolean().optional() })
      .safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'peticion_invalida' });
    if (await fueraDeScope(req, req.params.id)) return reply.code(403).send({ error: 'sucursal_ajena' });
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
    if (await fueraDeScope(req, req.params.id)) return reply.code(403).send({ error: 'sucursal_ajena' });
    await db
      .update(usuario)
      .set({ pinHash: await hashSecreto(p.data.pin), updatedAt: new Date() })
      .where(eq(usuario.id, req.params.id));
    return { ok: true };
  });

  // ── Sucursales (RF-B-1/2/3/4) ──
  // El administrador ve solo la suya; el superadmin, todas. Crear/editar
  // sucursales es exclusivo del superadmin.
  app.get('/admin/sucursales', soloAdmin, async (req) => {
    const suc = sucursalScope(req);
    return db.select().from(sucursal).where(suc ? eq(sucursal.id, suc) : undefined);
  });

  app.post('/admin/sucursales', soloSuper, async (req, reply) => {
    const p = z
      .object({ nombre: z.string().trim().min(1), direccion: z.string().trim().optional() })
      .safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'peticion_invalida' });
    const clave = await generarClave(db, p.data.nombre);
    const [s] = await db
      .insert(sucursal)
      .values({ id: randomUUID(), nombre: p.data.nombre, clave, direccion: p.data.direccion ?? null })
      .returning({ id: sucursal.id, clave: sucursal.clave });
    return { id: s?.id, clave: s?.clave };
  });

  // El superadmin puede cambiar la CLAVE de una sucursal (seguridad): al
  // rotarla, quien tenía la vieja ya no entra. Se normaliza a mayúsculas y debe
  // ser única.
  app.patch<{ Params: { id: string } }>('/admin/sucursales/:id', soloSuper, async (req, reply) => {
    const p = z
      .object({
        nombre: z.string().trim().min(1).optional(),
        direccion: z.string().trim().optional(),
        clave: z.string().trim().min(3).max(24).optional(),
        activo: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'peticion_invalida' });
    try {
      await db
        .update(sucursal)
        .set({
          ...(p.data.nombre !== undefined ? { nombre: p.data.nombre } : {}),
          ...(p.data.direccion !== undefined ? { direccion: p.data.direccion } : {}),
          ...(p.data.clave !== undefined ? { clave: p.data.clave.toUpperCase().replace(/\s+/g, '') } : {}),
          ...(p.data.activo !== undefined ? { activo: p.data.activo } : {}),
          updatedAt: new Date(),
        })
        .where(eq(sucursal.id, req.params.id));
    } catch {
      return reply.code(409).send({ error: 'clave_en_uso' });
    }
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
    if (!esSuperadmin(req) && req.sesion?.sucursalId !== c.sucursalId) {
      return reply.code(403).send({ error: 'sucursal_ajena' });
    }
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
