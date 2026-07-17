import { pgEnum } from 'drizzle-orm/pg-core';

// ── Organización ─────────────────────────────────────────────

/**
 * Visión §3. `superadmin` = dueño: alcance global, gestiona sucursales y crea
 * administradores. `administrador` = gerente de UNA sucursal. Ver 07 §roles.
 */
export const rolUsuario = pgEnum('rol_usuario', ['superadmin', 'administrador', 'cocina', 'mesero']);

// ── Comandas ─────────────────────────────────────────────────

export const tipoServicio = pgEnum('tipo_servicio', ['mesa', 'para_llevar', 'domicilio']);

/**
 * Proyección cacheada (ADR-002 / P1). La verdad es comanda_evento.
 * Se deriva de las líneas — ver 05. Casos de uso §4.3.
 */
export const estadoComanda = pgEnum('estado_comanda', [
  'borrador',
  'enviada',
  'en_preparacion',
  'lista',
  'entregada',
  'cobrada',
  'cancelada',
]);

/**
 * El estado fundamental del sistema. El de la comanda se deriva de este.
 *
 * La frontera de la merma es el paso de 'borrador' a 'pendiente': una vez
 * enviada a cocina, la comida se está haciendo (en una taquería el pastor se
 * corta al momento). Ver 04. Modelo de datos §4.4.
 *
 * 'en_preparacion' está reservado y NO se produce en el MVP: la vista de
 * cocina tiene un solo botón (✓ lista). Se conserva porque agregarlo después
 * sería una migración y quitarlo hoy no ahorra nada.
 */
export const estadoLinea = pgEnum('estado_linea', ['borrador', 'pendiente', 'en_preparacion', 'lista', 'cancelada']);

/** Log append-only. Fuente de verdad (ADR-002). */
export const tipoEvento = pgEnum('tipo_evento', [
  'comanda_creada',
  'linea_agregada',
  'linea_modificada',
  'linea_eliminada',
  'comanda_enviada',
  'preparacion_iniciada',
  'linea_lista',
  'comanda_lista',
  'comanda_entregada',
  'pago_registrado',
  'comanda_cobrada',
  'comanda_cancelada',
  'linea_cancelada',
  'comanda_reabierta',
]);

// ── Dinero ───────────────────────────────────────────────────

export const metodoPago = pgEnum('metodo_pago', ['efectivo', 'tarjeta', 'transferencia']);

export const estadoCorte = pgEnum('estado_corte', ['abierto', 'cerrado']);

export const categoriaGasto = pgEnum('categoria_gasto', ['insumo', 'servicio', 'sueldo', 'renta', 'otro']);

// ── Insumos (Fase 2) ─────────────────────────────────────────

export const unidadMedida = pgEnum('unidad_medida', ['kg', 'g', 'l', 'ml', 'pza', 'caja', 'manojo']);

export const tipoConteo = pgEnum('tipo_conteo', ['apertura', 'cierre']);
