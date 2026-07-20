import { sql } from 'drizzle-orm';
import { check, date, index, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { categoriaGasto, estadoCorte } from './enums';
import { sucursal, usuario } from './organizacion';

/**
 * Turno de caja. Toda comanda pertenece a exactamente uno (RF-H-2).
 *
 * El índice único parcial `corte_abierto_uq` garantiza a nivel de base que no
 * existan dos turnos abiertos en una sucursal. Si eso se rompiera, las
 * comandas se repartirían entre turnos y ningún corte cuadraría jamás
 * (RNF-I-4). Es una regla que la aplicación no puede olvidar.
 *
 * `pago` NO vive aquí: pertenece al agregado de la comanda (ver comanda.ts).
 */
export const corteCaja = pgTable(
  'corte_caja',
  {
    id: uuid('id').primaryKey(),
    sucursalId: uuid('sucursal_id')
      .notNull()
      .references(() => sucursal.id),
    estado: estadoCorte('estado').notNull().default('abierto'),
    fondoInicial: numeric('fondo_inicial', { precision: 10, scale: 2 }).notNull(),

    // Se llenan al cerrar. Un turno cerrado es inmutable (RF-H-10).
    /** Derivado: fondo_inicial + Σ pagos en efectivo (RF-H-4). */
    esperadoEfectivo: numeric('esperado_efectivo', { precision: 10, scale: 2 }),
    /** Capturado a mano contando el dinero físico (RF-H-5). */
    contadoEfectivo: numeric('contado_efectivo', { precision: 10, scale: 2 }),
    diferencia: numeric('diferencia', { precision: 10, scale: 2 }),
    totalTarjeta: numeric('total_tarjeta', { precision: 10, scale: 2 }),
    totalTransferencia: numeric('total_transferencia', { precision: 10, scale: 2 }),
    /** Obligatorio si |diferencia| supera el umbral (RF-H-7, RS-U-6). */
    motivoDiferencia: text('motivo_diferencia'),

    abiertoPor: uuid('abierto_por')
      .notNull()
      .references(() => usuario.id),
    abiertoAt: timestamp('abierto_at', { withTimezone: true }).notNull().defaultNow(),
    cerradoPor: uuid('cerrado_por').references(() => usuario.id),
    cerradoAt: timestamp('cerrado_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // RNF-I-4: un solo turno abierto por sucursal. Lo garantiza la base.
    uniqueIndex('corte_abierto_uq')
      .on(t.sucursalId)
      .where(sql`${t.estado} = 'abierto'`),
    check('fondo_no_negativo', sql`${t.fondoInicial} >= 0`),
  ],
);

/** RF-I-4. `fecha` es date, no timestamptz: un gasto es de un día contable. */
export const gasto = pgTable(
  'gasto',
  {
    id: uuid('id').primaryKey(),
    sucursalId: uuid('sucursal_id')
      .notNull()
      .references(() => sucursal.id),
    categoria: categoriaGasto('categoria').notNull(),
    concepto: text('concepto').notNull(),
    monto: numeric('monto', { precision: 10, scale: 2 }).notNull(),
    fecha: date('fecha').notNull(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => usuario.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('gasto_periodo_idx').on(t.sucursalId, t.fecha), check('gasto_positivo', sql`${t.monto} > 0`)],
);

/**
 * Retiro de efectivo del fondo durante un turno (RF-H): salidas de dinero de la
 * caja (p. ej. una compra de insumo pagada en efectivo). Se resta del esperado
 * al cerrar, para que el corte cuadre en vez de marcar faltante. Append-only
 * (la migración revoca UPDATE/DELETE a lena_app): es un movimiento de dinero.
 * `gasto_id` liga con el gasto que lo originó, si vino de una compra.
 */
export const retiroCaja = pgTable(
  'retiro_caja',
  {
    id: uuid('id').primaryKey(),
    corteCajaId: uuid('corte_caja_id')
      .notNull()
      .references(() => corteCaja.id),
    sucursalId: uuid('sucursal_id')
      .notNull()
      .references(() => sucursal.id),
    monto: numeric('monto', { precision: 10, scale: 2 }).notNull(),
    motivo: text('motivo').notNull(),
    gastoId: uuid('gasto_id').references(() => gasto.id),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => usuario.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('retiro_corte_idx').on(t.corteCajaId), check('retiro_positivo', sql`${t.monto} > 0`)],
);
