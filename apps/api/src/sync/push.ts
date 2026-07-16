// POST /sync/push — ingesta idempotente del log (RF-J-3, ADR-005).
//
// El log (comanda_evento) es la verdad. comanda y comanda_detalle son
// proyecciones que se RECONSTRUYEN plegando el log con @lena/shared: la misma
// función pura que corre en el cliente (RNF-M-7). No hay dos verdades.
import { and, eq, sql } from 'drizzle-orm';
import {
  DERIVA_MAXIMA_MS,
  aEventoDominio,
  aPesos,
  eventoPermitido,
  parsearHlc,
  plegarComanda,
} from '@lena/shared';
import type { EventoCable, EventoRechazado, PeticionPush, RespuestaPush } from '@lena/shared';
import { comanda, comandaDetalle, comandaEvento, corteCaja } from '@lena/db';
import type { Db } from '../db';
import { aDominio, aFila, mismoContenido } from './eventos';

function fecha(hlc: string): Date {
  return new Date(parsearHlc(hlc).fisico);
}

export async function procesarPush(db: Db, peticion: PeticionPush): Promise<RespuestaPush> {
  const rechazados: EventoRechazado[] = [];
  const aceptados: string[] = [];
  const folios: { comandaId: string; folio: number }[] = [];
  const ahora = Date.now();

  // Filtrado previo a la transacción: deriva de reloj y autorización.
  const porComanda = new Map<string, EventoCable[]>();
  for (const e of peticion.eventos) {
    const fisico = parsearHlc(e.hlc).fisico;
    if (fisico - ahora > DERIVA_MAXIMA_MS) {
      rechazados.push({
        id: e.id,
        razon: 'deriva_de_reloj',
        detalle: `HLC ${Math.round((fisico - ahora) / 1000)}s en el futuro`,
      });
      continue;
    }
    // Autorización como si cada evento fuera una petición REST — lo es (RS-Y-1).
    if (!eventoPermitido(e.tipo, e.rolActor)) {
      rechazados.push({
        id: e.id,
        razon: 'rol_no_autorizado',
        detalle: `${e.rolActor} no puede emitir ${e.tipo}`,
      });
      continue;
    }
    const grupo = porComanda.get(e.comandaId);
    if (grupo) grupo.push(e);
    else porComanda.set(e.comandaId, [e]);
  }

  await db.transaction(async (tx) => {
    for (const [cid, nuevos] of porComanda) {
      const existentes = (
        await tx.select().from(comandaEvento).where(eq(comandaEvento.comandaId, cid))
      ).map(aDominio);
      const existentesPorId = new Map(existentes.map((e) => [e.id, e]));

      // Idempotencia: id repetido con mismo contenido = éxito; con otro
      // contenido = intento de reescribir el log (RF-J-3).
      const aInsertar: EventoCable[] = [];
      for (const e of nuevos) {
        const prev = existentesPorId.get(e.id);
        if (prev) {
          if (mismoContenido(prev, e)) aceptados.push(e.id);
          else
            rechazados.push({
              id: e.id,
              razon: 'duplicado_con_otro_contenido',
              detalle: 'ese id ya existe con otro contenido',
            });
          continue;
        }
        aInsertar.push(e);
      }
      if (aInsertar.length === 0) continue;

      const comandaExiste = existentes.length > 0;

      if (!comandaExiste) {
        const creacion = aInsertar.find((e) => e.tipo === 'comanda_creada');
        if (!creacion) {
          // Eventos de una comanda que nunca se creó: no se materializan a
          // ciegas (RF-J-7). Podría ser un push desordenado; el cliente los
          // reintentará cuando la creación llegue.
          for (const e of aInsertar)
            rechazados.push({
              id: e.id,
              razon: 'comanda_desconocida',
              detalle: 'no llegó comanda_creada para esta comanda',
            });
          continue;
        }
        const [corte] = await tx
          .select({ id: corteCaja.id })
          .from(corteCaja)
          .where(and(eq(corteCaja.sucursalId, creacion.sucursalId), eq(corteCaja.estado, 'abierto')))
          .limit(1);
        if (!corte) {
          // RF-H-3: no hay comanda sin turno abierto.
          for (const e of aInsertar)
            rechazados.push({
              id: e.id,
              razon: 'sin_turno_abierto',
              detalle: 'no hay corte de caja abierto en la sucursal',
            });
          continue;
        }
        // Folio serializado por sucursal (RF-E-13). El lock evita que dos push
        // concurrentes asignen el mismo; el índice único es la última defensa.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${creacion.sucursalId}))`);
        const [max] = await tx
          .select({ folio: sql<number>`coalesce(max(${comanda.folio}), 0)` })
          .from(comanda)
          .where(eq(comanda.sucursalId, creacion.sucursalId));
        const folio = Number(max?.folio ?? 0) + 1;
        const p = creacion.payload as { tipoServicio: 'mesa' | 'para_llevar' | 'domicilio'; mesaId?: string };
        await tx.insert(comanda).values({
          id: cid,
          sucursalId: creacion.sucursalId,
          corteCajaId: corte.id,
          mesaId: p.mesaId ?? null,
          tipoServicio: p.tipoServicio,
          meseroId: creacion.actorId,
          folio,
          estado: 'borrador',
          total: '0',
          abiertaAt: fecha(creacion.hlc),
        });
        folios.push({ comandaId: cid, folio });
      }

      // comanda_detalle antes que los eventos: comanda_evento.detalle_id lo
      // referencia por FK.
      const detalles = aInsertar
        .filter((e) => e.tipo === 'linea_agregada' && e.detalleId)
        .map((e) => {
          const p = e.payload as {
            productoId: string;
            nombreProducto: string;
            precioUnitario: number;
            cantidad: number;
            notas?: string;
          };
          return {
            id: e.detalleId as string,
            comandaId: cid,
            productoId: p.productoId,
            nombreProducto: p.nombreProducto,
            precioUnitario: aPesos(p.precioUnitario),
            cantidad: p.cantidad,
            notas: p.notas ?? null,
            estado: 'borrador' as const,
          };
        });
      if (detalles.length) await tx.insert(comandaDetalle).values(detalles).onConflictDoNothing();

      const insertadas = await tx
        .insert(comandaEvento)
        .values(aInsertar.map(aFila))
        .onConflictDoNothing({ target: comandaEvento.id })
        .returning({ id: comandaEvento.id });
      const insertadasIds = new Set(insertadas.map((r) => r.id));
      for (const e of aInsertar) {
        // Un conflicto aquí (id ya existía por carrera) también es éxito: el
        // cliente debe poder vaciar su outbox.
        if (!aceptados.includes(e.id)) aceptados.push(e.id);
      }
      void insertadasIds;

      // Reconstruir proyecciones plegando TODO el log de la comanda.
      const c = plegarComanda(cid, [...existentes, ...aInsertar.map(aEventoDominio)]);
      if (!c) continue;

      const cierre = [...existentes, ...aInsertar.map(aEventoDominio)]
        .filter((e) => e.tipo === 'comanda_cobrada' || e.tipo === 'comanda_cancelada')
        .reduce<string | null>((max, e) => (!max || e.hlc > max ? e.hlc : max), null);

      await tx
        .update(comanda)
        .set({
          estado: c.estado,
          total: aPesos(c.total),
          motivoCancelacion: c.motivoCancelacion ?? null,
          cerradaAt: cierre ? fecha(cierre) : null,
        })
        .where(eq(comanda.id, cid));

      for (const l of c.lineas) {
        await tx
          .update(comandaDetalle)
          .set({
            estado: l.estado,
            cantidad: l.cantidad,
            notas: l.notas ?? null,
            enviadaAt: l.enviadaHlc ? fecha(l.enviadaHlc) : null,
            listaAt: l.listaHlc ? fecha(l.listaHlc) : null,
          })
          .where(eq(comandaDetalle.id, l.id));
      }
    }
  });

  // Cabeza global del log: el cliente sabe hasta dónde puede jalar.
  const [cabeza] = await db.select({ seq: sql<number>`coalesce(max(${comandaEvento.seq}), 0)` }).from(comandaEvento);
  return { aceptados, rechazados, folios, seq: Number(cabeza?.seq ?? 0) };
}
