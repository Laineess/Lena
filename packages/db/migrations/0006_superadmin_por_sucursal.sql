ALTER TABLE "usuario" DROP CONSTRAINT "admin_sin_sucursal";--> statement-breakpoint
ALTER TABLE "usuario" DROP CONSTRAINT "admin_usa_email";--> statement-breakpoint
ALTER TABLE "usuario" ALTER COLUMN "rol" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "comanda_evento" ALTER COLUMN "rol_actor" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."rol_usuario";--> statement-breakpoint
CREATE TYPE "public"."rol_usuario" AS ENUM('superadmin', 'administrador', 'cocina', 'mesero');--> statement-breakpoint
UPDATE "usuario" SET "rol" = 'superadmin' WHERE "rol" = 'administrador' AND "sucursal_id" IS NULL;--> statement-breakpoint
ALTER TABLE "usuario" ALTER COLUMN "rol" SET DATA TYPE "public"."rol_usuario" USING "rol"::"public"."rol_usuario";--> statement-breakpoint
ALTER TABLE "comanda_evento" ALTER COLUMN "rol_actor" SET DATA TYPE "public"."rol_usuario" USING "rol_actor"::"public"."rol_usuario";--> statement-breakpoint
ALTER TABLE "usuario" ADD CONSTRAINT "rol_scope" CHECK (("usuario"."rol" = 'superadmin' AND "usuario"."sucursal_id" IS NULL) OR ("usuario"."rol" <> 'superadmin' AND "usuario"."sucursal_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "usuario" ADD CONSTRAINT "rol_credencial" CHECK (("usuario"."rol" IN ('superadmin', 'administrador') AND "usuario"."email" IS NOT NULL AND "usuario"."password_hash" IS NOT NULL) OR ("usuario"."rol" IN ('cocina', 'mesero') AND "usuario"."pin_hash" IS NOT NULL));
