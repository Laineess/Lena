CREATE TABLE "producto_disponibilidad" (
	"producto_id" uuid NOT NULL,
	"sucursal_id" uuid NOT NULL,
	"disponible" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "producto_disponibilidad_producto_id_sucursal_id_pk" PRIMARY KEY("producto_id","sucursal_id")
);
--> statement-breakpoint
ALTER TABLE "producto_disponibilidad" ADD CONSTRAINT "producto_disponibilidad_producto_id_producto_id_fk" FOREIGN KEY ("producto_id") REFERENCES "public"."producto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "producto_disponibilidad" ADD CONSTRAINT "producto_disponibilidad_sucursal_id_sucursal_id_fk" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursal"("id") ON DELETE no action ON UPDATE no action;
