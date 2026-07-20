CREATE TABLE "retiro_caja" (
	"id" uuid PRIMARY KEY NOT NULL,
	"corte_caja_id" uuid NOT NULL,
	"sucursal_id" uuid NOT NULL,
	"monto" numeric(10, 2) NOT NULL,
	"motivo" text NOT NULL,
	"gasto_id" uuid,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retiro_positivo" CHECK ("retiro_caja"."monto" > 0)
);
--> statement-breakpoint
ALTER TABLE "retiro_caja" ADD CONSTRAINT "retiro_caja_corte_caja_id_corte_caja_id_fk" FOREIGN KEY ("corte_caja_id") REFERENCES "public"."corte_caja"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retiro_caja" ADD CONSTRAINT "retiro_caja_sucursal_id_sucursal_id_fk" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retiro_caja" ADD CONSTRAINT "retiro_caja_gasto_id_gasto_id_fk" FOREIGN KEY ("gasto_id") REFERENCES "public"."gasto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retiro_caja" ADD CONSTRAINT "retiro_caja_actor_id_usuario_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "retiro_corte_idx" ON "retiro_caja" USING btree ("corte_caja_id");--> statement-breakpoint
REVOKE UPDATE, DELETE ON "retiro_caja" FROM lena_app;
