-- ════════════════════════════════════════════════════════════════════
-- Migración manual. Drizzle no genera roles, REVOKE ni vistas.
--
--   1. Rol de aplicación separado del dueño       (RS-U-1)
--   2. Append-only en las tablas de auditoría     (control antifraude, T1)
--   3. Vistas derivadas                           (04. Modelo de datos §7)
-- ════════════════════════════════════════════════════════════════════


-- ────────────────────────────────────────────────────────────────────
-- 1. ROL DE APLICACIÓN
--
-- El REVOKE del punto 2 solo protege si la aplicación NO es dueña de las
-- tablas: un dueño puede volver a otorgarse permisos cuando quiera.
--
--   lena      → dueño. Corre migraciones. NUNCA lo usa el API.
--   lena_app  → rol del API. Sin UPDATE ni DELETE sobre el log.
--
-- Esta separación es lo que hace real a RS-U-1. Sin ella, el "log
-- append-only" es una convención que cualquier endpoint nuevo puede romper
-- por accidente.
-- ────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'lena_app') THEN
    -- La contraseña se cambia en el despliegue (Docs/11, §Roles).
    CREATE ROLE lena_app WITH LOGIN PASSWORD 'cambiame_en_el_despliegue';
  END IF;
END
$$;--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO lena_app;--> statement-breakpoint

-- Por defecto: lectura y escritura normal en todo.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lena_app;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO lena_app;--> statement-breakpoint

-- Y lo mismo para las tablas de migraciones futuras.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lena_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO lena_app;--> statement-breakpoint


-- ────────────────────────────────────────────────────────────────────
-- 2. APPEND-ONLY  (RS-U-1, RS-U-9, RNF-I-7)
--
-- La amenaza número uno de un punto de venta no es un hacker: es un
-- empleado cobrando en efectivo y cancelando en el sistema (07 §1).
--
-- El log de eventos es el control antifraude, y por eso la restricción vive
-- en la BASE y no en el código. Un ORM mal usado, un endpoint escrito con
-- prisa o una migración descuidada NO PUEDEN borrar el rastro.
-- ────────────────────────────────────────────────────────────────────

-- El log de eventos: la fuente de verdad (ADR-002).
REVOKE UPDATE, DELETE ON comanda_evento FROM lena_app;--> statement-breakpoint

-- Auditoría de cambios de precio (RF-D-4).
REVOKE UPDATE, DELETE ON producto_precio_historial FROM lena_app;--> statement-breakpoint

-- Merma: es una pérdida registrada. Borrarla la volvería invisible, que es
-- justo el problema de la Visión §1.
REVOKE UPDATE, DELETE ON merma_producto FROM lena_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON merma FROM lena_app;--> statement-breakpoint

-- Los pagos no se editan: se corrigen reabriendo la comanda (RF-G-8), y esa
-- reapertura también queda en el log.
REVOKE UPDATE, DELETE ON pago FROM lena_app;--> statement-breakpoint


-- ────────────────────────────────────────────────────────────────────
-- 3. VISTAS DERIVADAS  (04. Modelo de datos §7)
--
-- ⚠️ ZONA HORARIA: el corte del día es a medianoche LOCAL, no UTC (RES-4).
-- Un ::date sobre un timestamptz sin convertir manda las ventas de las 8 PM
-- del sábado al domingo, y el pronóstico por día de semana de la Fase 2
-- (RF-M-2) queda inservible. La conversión es OBLIGATORIA.
-- ────────────────────────────────────────────────────────────────────

-- Ventas granulares por día y producto.
-- Insumo de RF-I-2, RF-I-3, RF-I-6 y —sobre todo— del motor de Fase 2
-- (RF-M-1, RF-M-2). Por esto el MVP guarda ventas granulares desde el día 1:
-- sin historial, la Fase 2 arranca sin nada que aprender.
CREATE VIEW venta_diaria_producto AS
SELECT
  c.sucursal_id,
  (c.cerrada_at AT TIME ZONE 'America/Mexico_City')::date AS fecha,
  EXTRACT(ISODOW FROM c.cerrada_at AT TIME ZONE 'America/Mexico_City')::int AS dia_semana,
  d.producto_id,
  d.nombre_producto,
  SUM(d.cantidad)                     AS unidades,
  SUM(d.cantidad * d.precio_unitario) AS importe
FROM comanda c
JOIN comanda_detalle d ON d.comanda_id = c.id
WHERE c.estado = 'cobrada'
  AND d.estado <> 'cancelada'
GROUP BY 1, 2, 3, 4, 5;--> statement-breakpoint

-- Consumo derivado por conteo diferencial (RF-L-5):
--     consumo = conteo_apertura + compras − conteo_cierre
--
-- El negocio NO opera con recetas. La relación producto↔insumo se aprende
-- correlacionando esta vista contra venta_diaria_producto (RF-M-1).
CREATE VIEW consumo_diario_insumo AS
SELECT
  a.sucursal_id,
  a.insumo_id,
  a.fecha,
  a.cantidad                AS apertura,
  COALESCE(cp.cantidad, 0)  AS comprado,
  COALESCE(ci.cantidad, 0)  AS cierre,
  a.cantidad + COALESCE(cp.cantidad, 0) - COALESCE(ci.cantidad, 0) AS consumo,
  COALESCE(m.cantidad, 0)   AS merma_reportada
FROM conteo_insumo a
LEFT JOIN conteo_insumo ci
  ON ci.sucursal_id = a.sucursal_id
 AND ci.insumo_id   = a.insumo_id
 AND ci.fecha       = a.fecha
 AND ci.tipo        = 'cierre'
LEFT JOIN LATERAL (
  SELECT SUM(cantidad) AS cantidad
  FROM compra_insumo x
  WHERE x.sucursal_id = a.sucursal_id
    AND x.insumo_id   = a.insumo_id
    AND x.fecha       = a.fecha
) cp ON true
LEFT JOIN LATERAL (
  SELECT SUM(cantidad) AS cantidad
  FROM merma x
  WHERE x.sucursal_id = a.sucursal_id
    AND x.insumo_id   = a.insumo_id
    AND x.fecha       = a.fecha
) m ON true
WHERE a.tipo = 'apertura';--> statement-breakpoint

GRANT SELECT ON venta_diaria_producto TO lena_app;--> statement-breakpoint
GRANT SELECT ON consumo_diario_insumo TO lena_app;
