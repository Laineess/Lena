ALTER TABLE "sucursal" ADD COLUMN "clave" text;--> statement-breakpoint
UPDATE "sucursal" SET "clave" = upper(regexp_replace(substr(nombre, 1, 8), '[^a-zA-Z0-9]', '', 'g')) WHERE "clave" IS NULL;--> statement-breakpoint
UPDATE "sucursal" SET "clave" = "clave" || '-' || substr(replace(id::text, '-', ''), 1, 4) WHERE "clave" IN (SELECT "clave" FROM "sucursal" GROUP BY "clave" HAVING count(*) > 1);--> statement-breakpoint
ALTER TABLE "sucursal" ALTER COLUMN "clave" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sucursal" ADD CONSTRAINT "sucursal_clave_unique" UNIQUE("clave");
