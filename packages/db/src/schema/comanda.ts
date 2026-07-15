import { sql } from 'drizzle-orm';
import {
  bigserial,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { corteCaja } from './caja';
import { producto } from './catalogo';
import {
  estadoComanda,
  estadoLinea,
  metodoPago,
  tipoEvento,
  tipoServicio,
} from './enums';
import { dispositivo, mesa, sucursal, usuario } from './organizacion';

/**
 * Cabecera de la comanda.
 *
 * `id` es UUIDv7 generado EN EL CLIENTE (P2 / ADR-003): un mesero sin red
 * debe poder crear una comanda sin pedirle permiso a nadie.
 *
 * `estado` y `total` son proyecciones cacheadas (P1). La verdad es
 * comanda_evento y siempre son recomputables plegando el log.
 */
export const comanda = pgTable(
  'comanda',
  {
    id: uuid('id').primaryKey(),
    sucursalId: uuid('sucursal_id')
      .notNull()
      .references(() => sucursal.id),
    /**
     * NOT NULL implementa RF-H-3: es IMPOSIBLE crear una comanda sin turno
     * abierto. Regla de negocio como restricción, no como validación
     * olvidable (RNF-I-3).
     */
    corteCajaId: uuid('corte_caja_id')
      .notNull()
      .references(() => corteCaja.id),
    mesaId: uuid('mesa_id').references(() => mesa.id),
    tipoServicio: tipoServicio('tipo_servicio').notNull(),
    meseroId: uuid('mesero_id')
      .notNull()
      .references(() => usuario.id),
    /**
     * NULL hasta sincronizar (RF-E-13). Lo asigna el servidor: dos meseros
     * offline no pueden coordinar una secuencia sin colisionar (ADR-003).
     * Mientras tanto la UI muestra el identificador local (A-7).
     */
    folio: integer('folio'),

    /** Proyecciones cacheadas. Verdad = comanda_evento (P1). */
    estado: estadoComanda('estado').notNull().default('borrador'),
    total: numeric('total', { precision: 10, scale: 2 }).notNull().default('0'),

    motivoCancelacion: text('motivo_cancelacion'),
    abiertaAt: timestamp('abierta_at', { withTimezone: true }).notNull(),
    cerradaAt: timestamp('cerrada_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /**
     * Índice parcial: tolera los NULL de las comandas aún no sincronizadas.
     * Es la pieza que hace funcionar el offline (ADR-003).
     */
    uniqueIndex('comanda_folio_uq')
      .on(t.sucursalId, t.folio)
      .where(sql`${t.folio} IS NOT NULL`),
    index('comanda_abiertas_idx')
      .on(t.sucursalId, t.estado)
      .where(sql`${t.estado} NOT IN ('cobrada', 'cancelada')`),
    index('comanda_corte_idx').on(t.corteCajaId),
    check(
      'mesa_solo_si_es_en_mesa',
      sql`(${t.tipoServicio} = 'mesa' AND ${t.mesaId} IS NOT NULL)
       OR (${t.tipoServicio} <> 'mesa' AND ${t.mesaId} IS NULL)`,
    ),
    check(
      'cancelada_con_motivo',
      sql`${t.estado} <> 'cancelada' OR ${t.motivoCancelacion} IS NOT NULL`,
    ),
  ],
);

/**
 * Datos del cliente para entrega a domicilio (RF-E-17). 1:1 opcional.
 *
 * ⚠️ DATOS PERSONALES — LFPDPPP (RS-P-1 a RS-P-7).
 * Solo lo mínimo para entregar. Retención 18 meses; después se ANONIMIZA
 * conservando la venta (borrar la comanda descuadraría un corte cerrado).
 */
export const comandaDomicilio = pgTable(
  'comanda_domicilio',
  {
    comandaId: uuid('comanda_id')
      .primaryKey()
      .references(() => comanda.id),
    nombreCliente: text('nombre_cliente').notNull(),
    telefono: text('telefono').notNull(),
    direccion: text('direccion').notNull(),
    referencias: text('referencias'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** El teléfono es la llave de búsqueda del cliente frecuente (CU-07 G1). */
    index('comanda_domicilio_tel_idx').on(t.telefono),
  ],
);

/**
 * Línea de comanda. AQUÍ VIVE LA INMUTABILIDAD DEL DINERO (ADR-006 / P3).
 *
 * `nombreProducto` y `precioUnitario` son COPIAS al momento de la venta, no
 * lecturas. `productoId` está solo para trazabilidad y reportes.
 *
 * El total se calcula SUM(cantidad * precio_unitario) DE ESTA TABLA, jamás
 * con un JOIN a producto. Ese JOIN es tentador porque "normaliza", y es
 * exactamente el bug que ADR-006 previene: el precio de una venta no es un
 * atributo del producto, es un hecho del pasado (RNF-I-1).
 */
export const comandaDetalle = pgTable(
  'comanda_detalle',
  {
    id: uuid('id').primaryKey(),
    comandaId: uuid('comanda_id')
      .notNull()
      .references(() => comanda.id),
    /** Trazabilidad. NO es la fuente del precio. */
    productoId: uuid('producto_id')
      .notNull()
      .references(() => producto.id),

    // ── SNAPSHOT AL MOMENTO DE LA VENTA (RF-E-10) ──
    nombreProducto: text('nombre_producto').notNull(),
    precioUnitario: numeric('precio_unitario', { precision: 10, scale: 2 }).notNull(),

    cantidad: integer('cantidad').notNull(),
    /** "sin cebolla" (RF-E-3). */
    notas: text('notas'),
    /**
     * El estado fundamental del sistema: el de la comanda se DERIVA de este
     * (05 §4.3). Es lo que hace funcionar RF-E-7 sin código especial —
     * "la mesa pidió más tacos" sale gratis.
     */
    estado: estadoLinea('estado').notNull().default('borrador'),
    /** Cuándo dejó de ser borrador. Frontera de la merma (04 §4.4). */
    enviadaAt: timestamp('enviada_at', { withTimezone: true }),
    /** Métrica de tiempo de cocina (06 §10.2). */
    listaAt: timestamp('lista_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('comanda_detalle_comanda_idx').on(t.comandaId),
    index('comanda_detalle_producto_idx').on(t.productoId),
    check('cantidad_positiva', sql`${t.cantidad} > 0`),
    check('precio_no_negativo', sql`${t.precioUnitario} >= 0`),
    check(
      'enviada_tiene_fecha',
      sql`(${t.estado} = 'borrador' AND ${t.enviadaAt} IS NULL)
       OR (${t.estado} <> 'borrador' AND ${t.enviadaAt} IS NOT NULL)`,
    ),
  ],
);

/**
 * EL LOG DE EVENTOS — la fuente de verdad (ADR-002).
 *
 * APPEND-ONLY. No hay UPDATE ni DELETE, y se revoca a nivel de permisos de
 * Postgres (RS-U-1). Un ORM mal usado o una migración descuidada NO pueden
 * borrar el rastro.
 *
 * No es solo una decisión de sincronización: es el CONTROL ANTIFRAUDE del
 * sistema (07 §1). La amenaza número uno de un POS no es un hacker, es un
 * empleado cobrando en efectivo y cancelando en el sistema.
 *
 * Los dos relojes conviven porque resuelven cosas distintas:
 *   hlc  → ordena causalmente entre dispositivos (los relojes de tablet mienten)
 *   seq  → pagina el pull incremental (el HLC no es denso ni monótono global)
 */
export const comandaEvento = pgTable(
  'comanda_evento',
  {
    /** UUIDv7 del cliente → idempotencia (RF-J-3, RNF-I-5). */
    id: uuid('id').primaryKey(),
    /** Monótono del servidor → cursor de pull (ADR-005). */
    seq: bigserial('seq', { mode: 'number' }).notNull(),
    comandaId: uuid('comanda_id')
      .notNull()
      .references(() => comanda.id),
    detalleId: uuid('detalle_id').references(() => comandaDetalle.id),
    /**
     * Desnormalizado a propósito: el pull
     * (WHERE sucursal_id = ? AND seq > ?) es la consulta más caliente del
     * sistema y corre en cada reconexión. Un JOIN aquí sería pagar el precio
     * en el peor lugar posible.
     */
    sucursalId: uuid('sucursal_id')
      .notNull()
      .references(() => sucursal.id),
    tipo: tipoEvento('tipo').notNull(),
    payload: jsonb('payload').notNull().default({}),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => usuario.id),
    dispositivoId: uuid('dispositivo_id')
      .notNull()
      .references(() => dispositivo.id),
    /** Hybrid Logical Clock: orden causal pese a relojes desfasados (ADR-003). */
    hlc: text('hlc').notNull(),
    /** Informativo y NO confiable — ni por error ni por malicia (RS-Y-4). */
    tsCliente: timestamp('ts_cliente', { withTimezone: true }).notNull(),
    /** Lo sella el servidor al recibir. */
    tsServidor: timestamp('ts_servidor', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('comanda_evento_seq_idx').on(t.sucursalId, t.seq),
    index('comanda_evento_comanda_idx').on(t.comandaId, t.hlc),
  ],
);

/**
 * Pago. Varias filas por comanda = pago dividido (RF-G-3).
 *
 * No hay `metodo_pago` en la cabecera de la comanda, y esa ausencia ES el
 * soporte del split payment.
 *
 * ⚠️ RS-P-8: NUNCA se guarda un número de tarjeta, ni "temporalmente".
 * Registrar "se pagó con tarjeta" es contabilidad; guardar el número sería un
 * cambio de categoría regulatoria (PCI-DSS) que este negocio no puede pagar.
 */
export const pago = pgTable(
  'pago',
  {
    id: uuid('id').primaryKey(),
    comandaId: uuid('comanda_id')
      .notNull()
      .references(() => comanda.id),
    metodo: metodoPago('metodo').notNull(),
    monto: numeric('monto', { precision: 10, scale: 2 }).notNull(),
    /** Solo efectivo (RF-G-4). */
    recibido: numeric('recibido', { precision: 10, scale: 2 }),
    /** Solo efectivo, calculado. */
    cambio: numeric('cambio', { precision: 10, scale: 2 }),
    /** Tarjeta o transferencia (RF-G-5). Jamás el número de tarjeta. */
    referencia: text('referencia'),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => usuario.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('pago_comanda_idx').on(t.comandaId),
    check('monto_positivo', sql`${t.monto} > 0`),
    check(
      'efectivo_cuadra',
      sql`${t.metodo} <> 'efectivo' OR (${t.recibido} IS NOT NULL AND ${t.recibido} >= ${t.monto})`,
    ),
  ],
);

/**
 * Merma de PRODUCTO — la comida que ya se hizo y nadie pagó.
 *
 * NO es la misma tabla que `merma` (insumos.ts, Fase 2):
 *   merma_producto → 3 tacos ya preparados, en piezas, con comanda de origen
 *   merma          → 2 kg de carne cruda echada a perder, en kg, sin comanda
 * Mezclarlas obligaría a unidades incompatibles y perdería el vínculo con la
 * comanda que la originó.
 *
 * El CHECK codifica la regla: la frontera de la merma es EL ENVÍO A COCINA.
 * Una línea en 'borrador' no existió para nadie.
 *
 * Excepción que NO está en el esquema sino en la lógica (RF-F-14): si quien
 * cancela es el COCINERO, no hay merma — canceló porque no PUDO prepararlo.
 * Quien sabe si la comida se hizo es el cocinero, así que su cancelación es
 * autoritativa. Quién cancela ya codifica lo que esa persona sabe.
 *
 * En Fase 2 esta tabla alimenta al motor de compra (RF-M-7): el ratio
 * aprendido convierte "3 tacos de pastor mermados" en "0.24 kg de carne
 * consumidos sin venta".
 */
export const mermaProducto = pgTable(
  'merma_producto',
  {
    id: uuid('id').primaryKey(),
    sucursalId: uuid('sucursal_id')
      .notNull()
      .references(() => sucursal.id),
    comandaId: uuid('comanda_id')
      .notNull()
      .references(() => comanda.id),
    detalleId: uuid('detalle_id')
      .notNull()
      .references(() => comandaDetalle.id),
    productoId: uuid('producto_id')
      .notNull()
      .references(() => producto.id),

    /** Snapshot, mismo principio que comanda_detalle (P3). */
    nombreProducto: text('nombre_producto').notNull(),
    cantidad: integer('cantidad').notNull(),
    /** cantidad × precio_unitario de la línea. Es lo que se muestra en RF-E-18. */
    costoEstimado: numeric('costo_estimado', { precision: 10, scale: 2 }).notNull(),

    estadoAlCancelar: estadoLinea('estado_al_cancelar').notNull(),
    /** Heredado de la cancelación. Sin motivo el dato no sirve (RS-U-3). */
    motivo: text('motivo').notNull(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => usuario.id),
    fecha: date('fecha').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('merma_producto_periodo_idx').on(t.sucursalId, t.fecha),
    index('merma_producto_prod_idx').on(t.productoId, t.fecha),
    check('cantidad_positiva', sql`${t.cantidad} > 0`),
    // La base rechaza el registro de una merma que no pudo existir.
    check(
      'solo_si_ya_estaba_en_cocina',
      sql`${t.estadoAlCancelar} IN ('pendiente', 'en_preparacion', 'lista')`,
    ),
  ],
);
