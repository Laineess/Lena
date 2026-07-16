// Catálogo para el mesero (RF-D-1). Autenticado: cualquier rol lo lee.
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { aCentavos } from '@lena/shared';
import { categoria, mesa, producto } from '@lena/db';
import type { Db } from '../db';
import { requiereSesion } from '../auth/middleware';

export function registrarRutasCatalogo(app: FastifyInstance, db: Db): void {
  app.get('/catalogo', { preHandler: requiereSesion }, async (req) => {
    const sucursalId = req.sesion?.sucursalId;
    const [cats, prods, mesas] = await Promise.all([
      db.select().from(categoria).where(eq(categoria.activo, true)).orderBy(asc(categoria.orden)),
      db.select().from(producto).where(eq(producto.activo, true)).orderBy(asc(producto.nombre)),
      // Mesas de la sucursal de la sesión (RS-Z-2). El admin (sin sucursal) no ve mesas.
      sucursalId
        ? db.select().from(mesa).where(eq(mesa.sucursalId, sucursalId)).orderBy(asc(mesa.nombre))
        : Promise.resolve([]),
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
    };
  });
}
