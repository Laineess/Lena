// Catálogo para el mesero y la cocina (RF-D-1). Autenticado.
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { aCentavos } from '@lena/shared';
import { categoria, mesa, producto, productoDisponibilidad, sucursal } from '@lena/db';
import type { Db } from '../db';
import { requiereRol, requiereSesion } from '../auth/middleware';

export function registrarRutasCatalogo(app: FastifyInstance, db: Db): void {
  app.get('/catalogo', { preHandler: requiereSesion }, async (req) => {
    // El mesero/cocina ve SU sucursal (de la sesión). Solo el superadmin puede
    // pedir otra por ?sucursalId (para el panel de productos). RS-Z-2.
    const pedida = (req.query as { sucursalId?: string })?.sucursalId;
    const sucursalId = (req.sesion?.rol === 'superadmin' ? pedida : undefined) ?? req.sesion?.sucursalId ?? null;

    const [cats, prods, disp, mesas, suc] = await Promise.all([
      db.select().from(categoria).where(eq(categoria.activo, true)).orderBy(asc(categoria.orden)),
      db.select().from(producto).where(eq(producto.activo, true)).orderBy(asc(producto.nombre)),
      // Disponibilidad de ESTA sucursal (ausencia de fila = disponible).
      sucursalId
        ? db
            .select({ id: productoDisponibilidad.productoId, disponible: productoDisponibilidad.disponible })
            .from(productoDisponibilidad)
            .where(eq(productoDisponibilidad.sucursalId, sucursalId))
        : Promise.resolve([]),
      sucursalId
        ? db.select().from(mesa).where(eq(mesa.sucursalId, sucursalId)).orderBy(asc(mesa.nombre))
        : Promise.resolve([]),
      sucursalId ? db.select().from(sucursal).where(eq(sucursal.id, sucursalId)).limit(1) : Promise.resolve([]),
    ]);

    const dispPorProducto = new Map(disp.map((d) => [d.id, d.disponible]));

    // El precio va en centavos (RNF-I-8): el cliente jamás hace aritmética en pesos.
    return {
      categorias: cats.map((c) => ({ id: c.id, nombre: c.nombre, orden: c.orden })),
      productos: prods.map((p) => ({
        id: p.id,
        categoriaId: p.categoriaId,
        subcategoria: p.subcategoria,
        nombre: p.nombre,
        precio: aCentavos(p.precioBase),
        disponible: dispPorProducto.get(p.id) ?? true,
      })),
      mesas: mesas.filter((m) => m.activo).map((m) => ({ id: m.id, nombre: m.nombre })),
      // Umbrales del cronómetro de cocina en minutos (RF-F-8).
      umbrales: suc[0]
        ? { amarillo: suc[0].umbralAmarillo, naranja: suc[0].umbralNaranja, rojo: suc[0].umbralRojo }
        : { amarillo: 2, naranja: 5, rojo: 8 },
    };
  });

  // RF-F-10 / RF-D-7: marcar un producto no disponible ("se acabó") POR SUCURSAL.
  // Cocina y admin lo hacen en SU sucursal; el superadmin indica cuál. El mesero
  // NO. Es `disponible`, no `activo`: temporal, no baja lógica.
  const EsqDisp = z.object({ disponible: z.boolean(), sucursalId: z.string().uuid().optional() });
  app.patch<{ Params: { id: string } }>(
    '/productos/:id/disponibilidad',
    { preHandler: requiereRol('cocina', 'administrador', 'superadmin') },
    async (req, reply) => {
      const p = EsqDisp.safeParse(req.body);
      if (!p.success) return reply.code(400).send({ error: 'peticion_invalida' });
      const sucursalId = (req.sesion?.rol === 'superadmin' ? p.data.sucursalId : undefined) ?? req.sesion?.sucursalId;
      if (!sucursalId) return reply.code(400).send({ error: 'sucursal_requerida' });
      // Verifica que el producto exista y esté vigente.
      const [prod] = await db
        .select({ id: producto.id })
        .from(producto)
        .where(and(eq(producto.id, req.params.id), eq(producto.activo, true)))
        .limit(1);
      if (!prod) return reply.code(404).send({ error: 'no_encontrado' });
      await db
        .insert(productoDisponibilidad)
        .values({ productoId: req.params.id, sucursalId, disponible: p.data.disponible })
        .onConflictDoUpdate({
          target: [productoDisponibilidad.productoId, productoDisponibilidad.sucursalId],
          set: { disponible: p.data.disponible, updatedAt: new Date() },
        });
      return { id: req.params.id, disponible: p.data.disponible };
    },
  );
}
