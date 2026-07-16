// Historial de comandas de la sucursal (RF-E-12). El estado abierto se lee del
// log local en el dispositivo (offline); el histórico se consulta aquí, contra
// el servidor (RS-L-4), y jamás de otra sucursal (RS-Z-3).
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { aCentavos } from '@lena/shared';
import { comanda } from '@lena/db';
import type { Db } from '../db';
import { requiereSesion } from '../auth/middleware';

const CERRADAS = ['cobrada', 'cancelada'] as const;

export function registrarRutasComandas(app: FastifyInstance, db: Db): void {
  app.get('/comandas', { preHandler: requiereSesion }, async (req, reply) => {
    const sucursalId = req.sesion?.sucursalId;
    // El admin (sin sucursal) tendría que indicar cuál; el mesero usa la suya.
    if (!sucursalId) return reply.code(400).send({ error: 'sin_sucursal' });

    const filas = await db
      .select({
        id: comanda.id,
        folio: comanda.folio,
        tipoServicio: comanda.tipoServicio,
        mesaId: comanda.mesaId,
        estado: comanda.estado,
        total: comanda.total,
        cerradaAt: comanda.cerradaAt,
      })
      .from(comanda)
      .where(and(eq(comanda.sucursalId, sucursalId), inArray(comanda.estado, [...CERRADAS])))
      .orderBy(desc(comanda.cerradaAt))
      .limit(50);

    return filas.map((c) => ({ ...c, total: aCentavos(c.total) }));
  });
}
