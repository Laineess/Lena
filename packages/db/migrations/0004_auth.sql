CREATE TABLE "intento_auth" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid,
	"dispositivo_id" uuid,
	"exito" boolean NOT NULL,
	"ip" text,
	"motivo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sesion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"dispositivo_id" uuid,
	"refresh_hash" text NOT NULL,
	"familia" uuid DEFAULT gen_random_uuid() NOT NULL,
	"expira_at" timestamp with time zone NOT NULL,
	"revocada_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comanda_detalle" DROP CONSTRAINT "enviada_tiene_fecha";--> statement-breakpoint
ALTER TABLE "dispositivo" ADD COLUMN "token_hash" text;--> statement-breakpoint
ALTER TABLE "intento_auth" ADD CONSTRAINT "intento_auth_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intento_auth" ADD CONSTRAINT "intento_auth_dispositivo_id_dispositivo_id_fk" FOREIGN KEY ("dispositivo_id") REFERENCES "public"."dispositivo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sesion" ADD CONSTRAINT "sesion_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sesion" ADD CONSTRAINT "sesion_dispositivo_id_dispositivo_id_fk" FOREIGN KEY ("dispositivo_id") REFERENCES "public"."dispositivo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "intento_auth_disp_idx" ON "intento_auth" USING btree ("dispositivo_id","created_at");--> statement-breakpoint
CREATE INDEX "sesion_refresh_idx" ON "sesion" USING btree ("refresh_hash");--> statement-breakpoint
CREATE INDEX "sesion_usuario_idx" ON "sesion" USING btree ("usuario_id");--> statement-breakpoint
CREATE INDEX "sesion_familia_idx" ON "sesion" USING btree ("familia");--> statement-breakpoint
ALTER TABLE "comanda_detalle" ADD CONSTRAINT "enviada_tiene_fecha" CHECK (("comanda_detalle"."estado" = 'borrador' AND "comanda_detalle"."enviada_at" IS NULL)
       OR ("comanda_detalle"."estado" IN ('pendiente', 'en_preparacion', 'lista') AND "comanda_detalle"."enviada_at" IS NOT NULL)
       OR ("comanda_detalle"."estado" = 'cancelada'));--> statement-breakpoint
-- intento_auth es bitacora de seguridad (RS-A-10): append-only para la app.
REVOKE UPDATE, DELETE ON "intento_auth" FROM lena_app;
