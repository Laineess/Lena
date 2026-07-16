/**
 * Esquema de Leña — fuente de verdad de la estructura de datos.
 *
 * Las migraciones SQL en ./migrations se GENERAN de aquí con:
 *   pnpm db:generate
 * Nunca se editan a mano: divergirían del esquema y Drizzle dejaría de saber
 * en qué estado está la base.
 *
 * Ver Docs/4.-Modelo de datos.md para el razonamiento completo.
 *
 * Los cinco principios que explican todo lo que parezca raro:
 *   P1  El log de eventos es la verdad; estado y total son proyecciones
 *   P2  Las PK son UUIDv7 generadas en el cliente
 *   P3  El dinero histórico es inmutable (snapshot en la línea)
 *   P4  Nada se borra físicamente (baja lógica)
 *   P5  Las tablas de Fase 2 existen desde hoy
 */

export * from './enums';
export * from './organizacion';
export * from './catalogo';
export * from './caja';
export * from './comanda';
export * from './insumos';
export * from './auth';
