import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { dispositivo, usuario } from './organizacion';

/**
 * Sesión con refresh rotatorio (RS-A-7, RS-A-12).
 *
 * Cada refresh emite una fila nueva y revoca la anterior. `familia` agrupa la
 * cadena de rotaciones de un login: si llega un refresh ya revocado de una
 * familia, es señal de robo de token y se revoca la familia entera.
 */
export const sesion = pgTable(
  'sesion',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => usuario.id),
    /** NULL para el administrador central (entra sin dispositivo registrado). */
    dispositivoId: uuid('dispositivo_id').references(() => dispositivo.id),
    refreshHash: text('refresh_hash').notNull(),
    familia: uuid('familia').notNull().defaultRandom(),
    expiraAt: timestamp('expira_at', { withTimezone: true }).notNull(),
    revocadaAt: timestamp('revocada_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('sesion_refresh_idx').on(t.refreshHash),
    index('sesion_usuario_idx').on(t.usuarioId),
    index('sesion_familia_idx').on(t.familia),
  ],
);

/**
 * Bitácora de intentos de autenticación (RS-A-10). Append-only: la migración
 * revoca UPDATE/DELETE a lena_app. Es de dónde se deriva el bloqueo (RS-A-4).
 */
export const intentoAuth = pgTable(
  'intento_auth',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    usuarioId: uuid('usuario_id').references(() => usuario.id),
    dispositivoId: uuid('dispositivo_id').references(() => dispositivo.id),
    exito: boolean('exito').notNull(),
    ip: text('ip'),
    motivo: text('motivo'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('intento_auth_disp_idx').on(t.dispositivoId, t.createdAt)],
);
