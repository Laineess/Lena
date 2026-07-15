/**
 * FASE 2 — Insumos y compra sugerida.
 *
 * Estas tablas existen DESDE EL MVP aunque la UI no las use (P5, ADR §7).
 *
 * Motivo: el motor de recomendación pronostica por día de la semana con media
 * móvil (RF-M-2), y eso necesita SEMANAS de historial. Si no se guarda desde
 * el día 1, la Fase 2 arranca con cero datos y no puede recomendar nada
 * durante meses.
 *
 * NO HAY TABLA `receta` NI `producto_insumo`, y es deliberado. El negocio no
 * opera con escandallos: cuenta al surtir y cuenta al cerrar el día. La
 * relación producto↔insumo se APRENDE correlacionando ventas contra consumo
 * derivado (RF-M-1, con regr_slope() de Postgres). Modelar recetas obligaría
 * al gerente a mantener algo que no usa.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { tipoConteo, unidadMedida } from './enums';
import { sucursal, usuario } from './organizacion';

export const insumo = pgTable('insumo', {
  id: uuid('id').primaryKey(),
  nombre: text('nombre').notNull(),
  unidad: unidadMedida('unidad').notNull(),
  activo: boolean('activo').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const proveedor = pgTable('proveedor', {
  id: uuid('id').primaryKey(),
  nombre: text('nombre').notNull(),
  contacto: text('contacto'),
  activo: boolean('activo').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** RF-M-4. Parámetros de la recomendación de compra. */
export const insumoParametro = pgTable(
  'insumo_parametro',
  {
    insumoId: uuid('insumo_id')
      .notNull()
      .references(() => insumo.id),
    sucursalId: uuid('sucursal_id')
      .notNull()
      .references(() => sucursal.id),
    stockSeguridad: numeric('stock_seguridad', { precision: 12, scale: 3 })
      .notNull()
      .default('0'),
    diasEntrega: integer('dias_entrega').notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.insumoId, t.sucursalId] })],
);

/**
 * El corazón del modelo: conteo diferencial, no recetas (RF-L-3, RF-L-4).
 *
 *   consumo_del_día = conteo_apertura + compras − conteo_cierre
 *
 * El UNIQUE protege esa fórmula: dos conteos de cierre del mismo insumo el
 * mismo día harían que el consumo derivado sea ambiguo.
 *
 * Cantidades en numeric(12,3): los kilos y litros tienen fracciones.
 */
export const conteoInsumo = pgTable(
  'conteo_insumo',
  {
    id: uuid('id').primaryKey(),
    sucursalId: uuid('sucursal_id')
      .notNull()
      .references(() => sucursal.id),
    insumoId: uuid('insumo_id')
      .notNull()
      .references(() => insumo.id),
    tipo: tipoConteo('tipo').notNull(),
    cantidad: numeric('cantidad', { precision: 12, scale: 3 }).notNull(),
    fecha: date('fecha').notNull(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => usuario.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('conteo_unico_por_dia').on(t.sucursalId, t.insumoId, t.tipo, t.fecha),
    index('conteo_periodo_idx').on(t.sucursalId, t.insumoId, t.fecha),
    check('cantidad_no_negativa', sql`${t.cantidad} >= 0`),
  ],
);

/** RF-L-2. */
export const compraInsumo = pgTable(
  'compra_insumo',
  {
    id: uuid('id').primaryKey(),
    sucursalId: uuid('sucursal_id')
      .notNull()
      .references(() => sucursal.id),
    insumoId: uuid('insumo_id')
      .notNull()
      .references(() => insumo.id),
    proveedorId: uuid('proveedor_id').references(() => proveedor.id),
    cantidad: numeric('cantidad', { precision: 12, scale: 3 }).notNull(),
    costoTotal: numeric('costo_total', { precision: 10, scale: 2 }).notNull(),
    fecha: date('fecha').notNull(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => usuario.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('compra_periodo_idx').on(t.sucursalId, t.insumoId, t.fecha),
    check('cantidad_positiva', sql`${t.cantidad} > 0`),
    check('costo_no_negativo', sql`${t.costoTotal} >= 0`),
  ],
);

/**
 * Merma de INSUMO crudo: caducidad, derrame, mal estado (RF-L-6).
 *
 * Distinta de merma_producto (comanda.ts), que es comida ya preparada y
 * cancelada. Unidades y origen incompatibles.
 */
export const merma = pgTable(
  'merma',
  {
    id: uuid('id').primaryKey(),
    sucursalId: uuid('sucursal_id')
      .notNull()
      .references(() => sucursal.id),
    insumoId: uuid('insumo_id')
      .notNull()
      .references(() => insumo.id),
    cantidad: numeric('cantidad', { precision: 12, scale: 3 }).notNull(),
    /** Sin motivo el dato no sirve para nada. */
    motivo: text('motivo').notNull(),
    fecha: date('fecha').notNull(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => usuario.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('merma_periodo_idx').on(t.sucursalId, t.insumoId, t.fecha),
    check('cantidad_positiva', sql`${t.cantidad} > 0`),
  ],
);
