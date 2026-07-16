import { sql } from 'drizzle-orm';
import { bigint, boolean, check, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { rolUsuario } from './enums';

/**
 * Un despliegue = un negocio. Las sucursales viven dentro y son la frontera
 * de aislamiento. No hay tabla `organizacion`: R4 dice multi-sucursal, no
 * multi-tenant (ADR §2).
 */
export const sucursal = pgTable('sucursal', {
  id: uuid('id').primaryKey(),
  nombre: text('nombre').notNull(),
  direccion: text('direccion'),
  /**
   * Umbrales del cronómetro de cocina en MINUTOS (RF-F-8). Configurables por
   * sucursal: una comanda cambia a ámbar, naranja y rojo al cruzarlos.
   */
  umbralAmarillo: integer('umbral_amarillo').notNull().default(2),
  umbralNaranja: integer('umbral_naranja').notNull().default(5),
  umbralRojo: integer('umbral_rojo').notNull().default(8),
  /** Baja lógica (P4, RF-B-3). */
  activo: boolean('activo').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const usuario = pgTable(
  'usuario',
  {
    id: uuid('id').primaryKey(),
    /** NULL = Administrador Central, alcance global (RF-C-4). */
    sucursalId: uuid('sucursal_id').references(() => sucursal.id),
    nombre: text('nombre').notNull(),
    rol: rolUsuario('rol').notNull(),
    /** Solo administrador (RF-A-1). */
    email: text('email').unique(),
    /** Argon2id (RS-A-1). Solo administrador. */
    passwordHash: text('password_hash'),
    /** Argon2id (RS-A-1). Mesero y cocina (RF-A-2). */
    pinHash: text('pin_hash'),
    /** Baja lógica: sus comandas históricas conservan la autoría (RF-C-3). */
    activo: boolean('activo').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'admin_sin_sucursal',
      sql`(${t.rol} = 'administrador' AND ${t.sucursalId} IS NULL)
       OR (${t.rol} <> 'administrador' AND ${t.sucursalId} IS NOT NULL)`,
    ),
    check(
      'admin_usa_email',
      sql`(${t.rol} = 'administrador' AND ${t.email} IS NOT NULL AND ${t.passwordHash} IS NOT NULL)
       OR (${t.rol} <> 'administrador' AND ${t.pinHash} IS NOT NULL)`,
    ),
  ],
);

/**
 * El PIN autentica a la persona; el dispositivo registrado autentica al lugar
 * (ADR-007). Un PIN solo sirve desde un dispositivo dado de alta.
 */
export const dispositivo = pgTable(
  'dispositivo',
  {
    id: uuid('id').primaryKey(),
    sucursalId: uuid('sucursal_id')
      .notNull()
      .references(() => sucursal.id),
    nombre: text('nombre').notNull(),
    /**
     * Letra para el identificador local que se vocea en "para llevar":
     * A-1, A-2… (09. Diseño de interfaz §4.2). Única por sucursal.
     */
    letra: text('letra').notNull(),
    /** Credencial del dispositivo (Argon2id). El PIN autentica a la persona; esto
     * autentica al lugar (ADR-007). NULL hasta que el admin lo registre. */
    tokenHash: text('token_hash'),
    activo: boolean('activo').notNull().default(true),
    /** Diagnóstico (RNF-O-5). El cursor real de sync vive en el cliente. */
    ultimoSeq: bigint('ultimo_seq', { mode: 'number' }).notNull().default(0),
    ultimaSyncAt: timestamp('ultima_sync_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('dispositivo_letra_uq').on(t.sucursalId, t.letra)],
);

export const mesa = pgTable(
  'mesa',
  {
    id: uuid('id').primaryKey(),
    sucursalId: uuid('sucursal_id')
      .notNull()
      .references(() => sucursal.id),
    nombre: text('nombre').notNull(),
    activo: boolean('activo').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('mesa_nombre_uq').on(t.sucursalId, t.nombre)],
);
