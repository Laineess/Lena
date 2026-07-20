import { sql } from 'drizzle-orm';
import { boolean, check, integer, numeric, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sucursal, usuario } from './organizacion';

export const categoria = pgTable('categoria', {
  id: uuid('id').primaryKey(),
  nombre: text('nombre').notNull(),
  /** Orden de despliegue en la UI (RF-D-6). */
  orden: integer('orden').notNull().default(0),
  activo: boolean('activo').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * El catálogo es global al negocio; todas las sucursales lo comparten (RF-D-9).
 *
 * `precio_base` es el precio VIGENTE. NO es la fuente del precio de una venta
 * pasada: eso vive copiado en comanda_detalle (ADR-006). Cambiar este campo
 * jamás altera una comanda existente.
 */
export const producto = pgTable(
  'producto',
  {
    id: uuid('id').primaryKey(),
    categoriaId: uuid('categoria_id')
      .notNull()
      .references(() => categoria.id),
    nombre: text('nombre').notNull(),
    descripcion: text('descripcion'),
    /** Subcategoría de texto libre (RF-D-6): la escribe el admin al dar de alta
     * el producto. Ej. Bebidas → "Jugos", Platillos → "Vegetarianos". */
    subcategoria: text('subcategoria'),
    precioBase: numeric('precio_base', { precision: 10, scale: 2 }).notNull(),
    /** Permanente: "ya no vendemos esto". Lo decide el negocio (RF-D-5).
     * El "se acabó" (RF-D-7) es POR SUCURSAL: ver `productoDisponibilidad`. */
    activo: boolean('activo').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('precio_base_no_negativo', sql`${t.precioBase} >= 0`)],
);

/**
 * Auditoría de cambios de precio (RF-D-4, RS-U-4). Append-only.
 *
 * NO es la fuente del precio histórico: los tickets viejos son correctos
 * gracias al snapshot en comanda_detalle, no gracias a esta tabla. Es
 * intencional — una tabla de auditoría corrupta no debe poder alterar dinero.
 */
export const productoPrecioHistorial = pgTable('producto_precio_historial', {
  id: uuid('id').primaryKey(),
  productoId: uuid('producto_id')
    .notNull()
    .references(() => producto.id),
  precioAnterior: numeric('precio_anterior', { precision: 10, scale: 2 }).notNull(),
  precioNuevo: numeric('precio_nuevo', { precision: 10, scale: 2 }).notNull(),
  actorId: uuid('actor_id')
    .notNull()
    .references(() => usuario.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Disponibilidad ("se acabó") POR SUCURSAL (RF-D-7). Cada sucursal agota
 * distinto: Norte se queda sin pastor y Centro sigue teniéndolo. Ausencia de
 * fila = disponible. El catálogo del mesero/cocina se resuelve con su sucursal.
 */
export const productoDisponibilidad = pgTable(
  'producto_disponibilidad',
  {
    productoId: uuid('producto_id')
      .notNull()
      .references(() => producto.id),
    sucursalId: uuid('sucursal_id')
      .notNull()
      .references(() => sucursal.id),
    disponible: boolean('disponible').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.productoId, t.sucursalId] })],
);

/** Override de precio por sucursal (RF-D-8, prioridad C). */
export const productoPrecioSucursal = pgTable(
  'producto_precio_sucursal',
  {
    productoId: uuid('producto_id')
      .notNull()
      .references(() => producto.id),
    sucursalId: uuid('sucursal_id')
      .notNull()
      .references(() => sucursal.id),
    precio: numeric('precio', { precision: 10, scale: 2 }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.productoId, t.sucursalId] }), check('precio_no_negativo', sql`${t.precio} >= 0`)],
);
