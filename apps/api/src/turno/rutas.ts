// Turno de caja (RF-H). Abrir/cerrar/consultar. NO es event-sourced: el corte
// es una tabla normal, no parte del log de comandas. Auth: mesero y admin.
import { randomUUID } from 'node:crypto';
import { and, eq, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { aCentavos, aPesos } from '@lena/shared';
import { comanda, corteCaja, pago } from '@lena/db';
import type { Db } from '../db';
import { requiereRol } from '../auth/middleware';

// RF-H-7: umbral de diferencia que exige motivo. $20 (configurable a futuro).
const UMBRAL_DIFERENCIA = 2000; // centavos

const soloCajero = { preHandler: requiereRol('mesero', 'administrador') };

export function registrarRutasTurno(app: FastifyInstance, db: Db): void {
  // El turno abierto de la sucursal de la sesión, o null.
  app.get('/turno/actual', soloCajero, async (req, reply) => {
    const sucursalId = req.sesion?.sucursalId;
    if (!sucursalId) return reply.code(400).send({ error: 'sin_sucursal' });
    const [c] = await db
      .select()
      .from(corteCaja)
      .where(and(eq(corteCaja.sucursalId, sucursalId), eq(corteCaja.estado, 'abierto')))
      .limit(1);
    return c ? { id: c.id, fondoInicial: aCentavos(c.fondoInicial), abiertoAt: c.abiertoAt } : null;
  });

  // RF-H-1: abre el turno con fondo inicial. El índice único parcial garantiza
  // que no haya dos abiertos (RNF-I-4): si ya hay uno, la inserción falla.
  app.post('/turno/abrir', soloCajero, async (req, reply) => {
    const p = z.object({ fondoInicial: z.number().int().nonnegative() }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'peticion_invalida' });
    const sucursalId = req.sesion?.sucursalId;
    if (!sucursalId) return reply.code(400).send({ error: 'sin_sucursal' });
    try {
      const [c] = await db
        .insert(corteCaja)
        .values({
          id: randomUUID(),
          sucursalId,
          fondoInicial: aPesos(p.data.fondoInicial),
          abiertoPor: req.sesion?.usuarioId as string,
          estado: 'abierto',
        })
        .returning({ id: corteCaja.id });
      return { id: c?.id };
    } catch {
      // Choca con el índice corte_abierto_uq: ya hay un turno abierto.
      return reply.code(409).send({ error: 'turno_ya_abierto' });
    }
  });

  // RF-H-4/5/6/8: cierra el turno. Bloquea si hay comandas abiertas.
  app.post('/turno/cerrar', soloCajero, async (req, reply) => {
    const p = z
      .object({ contadoEfectivo: z.number().int().nonnegative(), motivo: z.string().trim().optional() })
      .safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'peticion_invalida' });
    const sucursalId = req.sesion?.sucursalId;
    if (!sucursalId) return reply.code(400).send({ error: 'sin_sucursal' });

    const [turno] = await db
      .select()
      .from(corteCaja)
      .where(and(eq(corteCaja.sucursalId, sucursalId), eq(corteCaja.estado, 'abierto')))
      .limit(1);
    if (!turno) return reply.code(404).send({ error: 'sin_turno_abierto' });

    // RF-H-8: no se cierra con comandas abiertas; se listan para resolverlas.
    const abiertas = await db
      .select({ id: comanda.id, estado: comanda.estado })
      .from(comanda)
      .where(and(eq(comanda.corteCajaId, turno.id), ne(comanda.estado, 'cobrada'), ne(comanda.estado, 'cancelada')));
    if (abiertas.length > 0) {
      return reply.code(409).send({ error: 'comandas_abiertas', comandas: abiertas });
    }

    // Desglose por método (RF-H-6): suma de pagos de las comandas de este corte.
    const sumas = await db
      .select({ metodo: pago.metodo, total: sql<string>`coalesce(sum(${pago.monto}), 0)` })
      .from(pago)
      .innerJoin(comanda, eq(pago.comandaId, comanda.id))
      .where(and(eq(comanda.corteCajaId, turno.id), eq(comanda.estado, 'cobrada')))
      .groupBy(pago.metodo);

    const porMetodo = new Map(sumas.map((s) => [s.metodo, aCentavos(s.total)]));
    const efectivoCobrado = porMetodo.get('efectivo') ?? 0;
    const tarjeta = porMetodo.get('tarjeta') ?? 0;
    const transferencia = porMetodo.get('transferencia') ?? 0;

    const fondo = aCentavos(turno.fondoInicial);
    const esperado = fondo + efectivoCobrado; // RF-H-4
    const diferencia = p.data.contadoEfectivo - esperado; // RF-H-5

    // RF-H-7: motivo obligatorio si |diferencia| supera el umbral.
    if (Math.abs(diferencia) > UMBRAL_DIFERENCIA && !p.data.motivo) {
      return reply.code(400).send({ error: 'motivo_requerido', diferencia });
    }

    await db
      .update(corteCaja)
      .set({
        estado: 'cerrado',
        esperadoEfectivo: aPesos(esperado),
        contadoEfectivo: aPesos(p.data.contadoEfectivo),
        diferencia: aPesos(diferencia),
        totalTarjeta: aPesos(tarjeta),
        totalTransferencia: aPesos(transferencia),
        motivoDiferencia: p.data.motivo ?? null,
        cerradoPor: req.sesion?.usuarioId as string,
        cerradoAt: new Date(),
      })
      .where(eq(corteCaja.id, turno.id));

    return {
      esperado,
      contado: p.data.contadoEfectivo,
      diferencia,
      desglose: { efectivo: efectivoCobrado, tarjeta, transferencia },
    };
  });
}
