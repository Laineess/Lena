-- El check anterior exigia enviada_at NOT NULL para TODO estado <> borrador,
-- pero el dominio permite cancelar una linea en borrador (o que nazca cancelada
-- porque la comanda ya cerro, 05 §5). Esa linea nunca cruzo a cocina:
-- enviada_at es NULL y es correcto. Sin este arreglo, el primer evento de
-- cancelacion offline revienta el push con violacion de constraint.
ALTER TABLE "comanda_detalle" DROP CONSTRAINT "enviada_tiene_fecha";
--> statement-breakpoint
ALTER TABLE "comanda_detalle" ADD CONSTRAINT "enviada_tiene_fecha" CHECK (
  ("estado" = 'borrador' AND "enviada_at" IS NULL)
  OR ("estado" IN ('pendiente', 'en_preparacion', 'lista') AND "enviada_at" IS NOT NULL)
  OR ("estado" = 'cancelada')
);
