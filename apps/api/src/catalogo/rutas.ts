// Catálogo para el mesero y la cocina (RF-D-1). Autenticado.
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { aCentavos } from '@lena/shared';
import { categoria, mesa, producto, sucursal } from '@lena/db';
import type { Db } from '../db';
import { requiereRol, requiereSesion } from '../auth/middleware';

export function registrarRutasCatalogo(app: FastifyInstance, db: Db): void {
  app.get('/catalogo', { preHandler: requiereSesion }, async (req) => {
    const sucursalId = req.sesion?.sucursalId;
    const [cats, prods, mesas, suc] = await Promise.all([
      db.select().from(categoria).where(eq(categoria.activo, true)).orderBy(asc(categoria.orden)),
      db.select().from(producto).where(eq(producto.activo, true)).orderBy(asc(producto.nombre)),
      // Mesas de la sucursal de la sesión (RS-Z-2). El admin (sin sucursal) no ve mesas.
      sucursalId
        ? db.select().from(mesa).where(eq(mesa.sucursalId, sucursalId)).orderBy(asc(mesa.nombre))
        : Promise.resolve([]),
      sucursalId ? db.select().from(sucursal).where(eq(sucursal.id, sucursalId)).limit(1) : Promise.resolve([]),
    ]);

    // El precio va en centavos (RNF-I-8): el cliente jamás hace aritmética en pesos.
    return {
      categorias: cats.map((c) => ({ id: c.id, nombre: c.nombre, orden: c.orden })),
      productos: prods.map((p) => ({
        id: p.id,
        categoriaId: p.categoriaId,
        nombre: p.nombre,
        precio: aCentavos(p.precioBase),
        disponible: p.disponible,
      })),
      mesas: mesas.filter((m) => m.activo).map((m) => ({ id: m.id, nombre: m.nombre })),
      // Umbrales del cronómetro de cocina en minutos (RF-F-8).
      umbrales: suc[0]
        ? { amarillo: suc[0].umbralAmarillo, naranja: suc[0].umbralNaranja, rojo: suc[0].umbralRojo }
        : { amarillo: 2, naranja: 5, rojo: 8 },
    };
  });

  // RF-F-10: marcar un producto no disponible ("se acabó"). Cocina y admin
  // (matriz de permisos 07 §4.1); el mesero NO. Es `disponible`, no `activo`:
  // temporal, no baja lógica (RF-D-5 vs RF-D-7).
  const EsqDisp = z.object({ disponible: z.boolean() });
  app.patch<{ Params: { id: string } }>(
    '/productos/:id/disponibilidad',
    { preHandler: requiereRol('cocina', 'administrador') },
    async (req, reply) => {
      const p = EsqDisp.safeParse(req.body);
      if (!p.success) return reply.code(400).send({ error: 'peticion_invalida' });
      const [prod] = await db
        .update(producto)
        .set({ disponible: p.data.disponible })
        .where(and(eq(producto.id, req.params.id), eq(producto.activo, true)))
        .returning({ id: producto.id, disponible: producto.disponible });
      if (!prod) return reply.code(404).send({ error: 'no_encontrado' });
      return prod;
    },
  );
}
