CREATE TYPE "public"."categoria_gasto" AS ENUM('insumo', 'servicio', 'sueldo', 'renta', 'otro');--> statement-breakpoint
CREATE TYPE "public"."estado_comanda" AS ENUM('borrador', 'enviada', 'en_preparacion', 'lista', 'entregada', 'cobrada', 'cancelada');--> statement-breakpoint
CREATE TYPE "public"."estado_corte" AS ENUM('abierto', 'cerrado');--> statement-breakpoint
CREATE TYPE "public"."estado_linea" AS ENUM('borrador', 'pendiente', 'en_preparacion', 'lista', 'cancelada');--> statement-breakpoint
CREATE TYPE "public"."metodo_pago" AS ENUM('efectivo', 'tarjeta', 'transferencia');--> statement-breakpoint
CREATE TYPE "public"."rol_usuario" AS ENUM('administrador', 'cocina', 'mesero');--> statement-breakpoint
CREATE TYPE "public"."tipo_conteo" AS ENUM('apertura', 'cierre');--> statement-breakpoint
CREATE TYPE "public"."tipo_evento" AS ENUM('comanda_creada', 'linea_agregada', 'linea_modificada', 'linea_eliminada', 'comanda_enviada', 'preparacion_iniciada', 'linea_lista', 'comanda_lista', 'comanda_entregada', 'pago_registrado', 'comanda_cobrada', 'comanda_cancelada', 'linea_cancelada', 'comanda_reabierta');--> statement-breakpoint
CREATE TYPE "public"."tipo_servicio" AS ENUM('mesa', 'para_llevar', 'domicilio');--> statement-breakpoint
CREATE TYPE "public"."unidad_medida" AS ENUM('kg', 'g', 'l', 'ml', 'pza', 'caja', 'manojo');--> statement-breakpoint
CREATE TABLE "dispositivo" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sucursal_id" uuid NOT NULL,
	"nombre" text NOT NULL,
	"letra" text NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"ultimo_seq" bigint DEFAULT 0 NOT NULL,
	"ultima_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispositivo_letra_uq" UNIQUE("sucursal_id","letra")
);
--> statement-breakpoint
CREATE TABLE "mesa" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sucursal_id" uuid NOT NULL,
	"nombre" text NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mesa_nombre_uq" UNIQUE("sucursal_id","nombre")
);
--> statement-breakpoint
CREATE TABLE "sucursal" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"direccion" text,
	"activo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usuario" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sucursal_id" uuid,
	"nombre" text NOT NULL,
	"rol" "rol_usuario" NOT NULL,
	"email" text,
	"password_hash" text,
	"pin_hash" text,
	"activo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usuario_email_unique" UNIQUE("email"),
	CONSTRAINT "admin_sin_sucursal" CHECK (("usuario"."rol" = 'administrador' AND "usuario"."sucursal_id" IS NULL)
       OR ("usuario"."rol" <> 'administrador' AND "usuario"."sucursal_id" IS NOT NULL)),
	CONSTRAINT "admin_usa_email" CHECK (("usuario"."rol" = 'administrador' AND "usuario"."email" IS NOT NULL AND "usuario"."password_hash" IS NOT NULL)
       OR ("usuario"."rol" <> 'administrador' AND "usuario"."pin_hash" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "categoria" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"orden" integer DEFAULT 0 NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "producto" (
	"id" uuid PRIMARY KEY NOT NULL,
	"categoria_id" uuid NOT NULL,
	"nombre" text NOT NULL,
	"descripcion" text,
	"precio_base" numeric(10, 2) NOT NULL,
	"disponible" boolean DEFAULT true NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "precio_base_no_negativo" CHECK ("producto"."precio_base" >= 0)
);
--> statement-breakpoint
CREATE TABLE "producto_precio_historial" (
	"id" uuid PRIMARY KEY NOT NULL,
	"producto_id" uuid NOT NULL,
	"precio_anterior" numeric(10, 2) NOT NULL,
	"precio_nuevo" numeric(10, 2) NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "producto_precio_sucursal" (
	"producto_id" uuid NOT NULL,
	"sucursal_id" uuid NOT NULL,
	"precio" numeric(10, 2) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "producto_precio_sucursal_producto_id_sucursal_id_pk" PRIMARY KEY("producto_id","sucursal_id"),
	CONSTRAINT "precio_no_negativo" CHECK ("producto_precio_sucursal"."precio" >= 0)
);
--> statement-breakpoint
CREATE TABLE "corte_caja" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sucursal_id" uuid NOT NULL,
	"estado" "estado_corte" DEFAULT 'abierto' NOT NULL,
	"fondo_inicial" numeric(10, 2) NOT NULL,
	"esperado_efectivo" numeric(10, 2),
	"contado_efectivo" numeric(10, 2),
	"diferencia" numeric(10, 2),
	"total_tarjeta" numeric(10, 2),
	"total_transferencia" numeric(10, 2),
	"motivo_diferencia" text,
	"abierto_por" uuid NOT NULL,
	"abierto_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cerrado_por" uuid,
	"cerrado_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fondo_no_negativo" CHECK ("corte_caja"."fondo_inicial" >= 0)
);
--> statement-breakpoint
CREATE TABLE "gasto" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sucursal_id" uuid NOT NULL,
	"categoria" "categoria_gasto" NOT NULL,
	"concepto" text NOT NULL,
	"monto" numeric(10, 2) NOT NULL,
	"fecha" date NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gasto_positivo" CHECK ("gasto"."monto" > 0)
);
--> statement-breakpoint
CREATE TABLE "comanda" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sucursal_id" uuid NOT NULL,
	"corte_caja_id" uuid NOT NULL,
	"mesa_id" uuid,
	"tipo_servicio" "tipo_servicio" NOT NULL,
	"mesero_id" uuid NOT NULL,
	"folio" integer,
	"estado" "estado_comanda" DEFAULT 'borrador' NOT NULL,
	"total" numeric(10, 2) DEFAULT '0' NOT NULL,
	"motivo_cancelacion" text,
	"abierta_at" timestamp with time zone NOT NULL,
	"cerrada_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mesa_solo_si_es_en_mesa" CHECK (("comanda"."tipo_servicio" = 'mesa' AND "comanda"."mesa_id" IS NOT NULL)
       OR ("comanda"."tipo_servicio" <> 'mesa' AND "comanda"."mesa_id" IS NULL)),
	CONSTRAINT "cancelada_con_motivo" CHECK ("comanda"."estado" <> 'cancelada' OR "comanda"."motivo_cancelacion" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "comanda_detalle" (
	"id" uuid PRIMARY KEY NOT NULL,
	"comanda_id" uuid NOT NULL,
	"producto_id" uuid NOT NULL,
	"nombre_producto" text NOT NULL,
	"precio_unitario" numeric(10, 2) NOT NULL,
	"cantidad" integer NOT NULL,
	"notas" text,
	"estado" "estado_linea" DEFAULT 'borrador' NOT NULL,
	"enviada_at" timestamp with time zone,
	"lista_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cantidad_positiva" CHECK ("comanda_detalle"."cantidad" > 0),
	CONSTRAINT "precio_no_negativo" CHECK ("comanda_detalle"."precio_unitario" >= 0),
	CONSTRAINT "enviada_tiene_fecha" CHECK (("comanda_detalle"."estado" = 'borrador' AND "comanda_detalle"."enviada_at" IS NULL)
       OR ("comanda_detalle"."estado" <> 'borrador' AND "comanda_detalle"."enviada_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "comanda_domicilio" (
	"comanda_id" uuid PRIMARY KEY NOT NULL,
	"nombre_cliente" text NOT NULL,
	"telefono" text NOT NULL,
	"direccion" text NOT NULL,
	"referencias" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comanda_evento" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seq" bigserial NOT NULL,
	"comanda_id" uuid NOT NULL,
	"detalle_id" uuid,
	"sucursal_id" uuid NOT NULL,
	"tipo" "tipo_evento" NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_id" uuid NOT NULL,
	"dispositivo_id" uuid NOT NULL,
	"hlc" text NOT NULL,
	"ts_cliente" timestamp with time zone NOT NULL,
	"ts_servidor" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merma_producto" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sucursal_id" uuid NOT NULL,
	"comanda_id" uuid NOT NULL,
	"detalle_id" uuid NOT NULL,
	"producto_id" uuid NOT NULL,
	"nombre_producto" text NOT NULL,
	"cantidad" integer NOT NULL,
	"costo_estimado" numeric(10, 2) NOT NULL,
	"estado_al_cancelar" "estado_linea" NOT NULL,
	"motivo" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"fecha" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cantidad_positiva" CHECK ("merma_producto"."cantidad" > 0),
	CONSTRAINT "solo_si_ya_estaba_en_cocina" CHECK ("merma_producto"."estado_al_cancelar" IN ('pendiente', 'en_preparacion', 'lista'))
);
--> statement-breakpoint
CREATE TABLE "pago" (
	"id" uuid PRIMARY KEY NOT NULL,
	"comanda_id" uuid NOT NULL,
	"metodo" "metodo_pago" NOT NULL,
	"monto" numeric(10, 2) NOT NULL,
	"recibido" numeric(10, 2),
	"cambio" numeric(10, 2),
	"referencia" text,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monto_positivo" CHECK ("pago"."monto" > 0),
	CONSTRAINT "efectivo_cuadra" CHECK ("pago"."metodo" <> 'efectivo' OR ("pago"."recibido" IS NOT NULL AND "pago"."recibido" >= "pago"."monto"))
);
--> statement-breakpoint
CREATE TABLE "compra_insumo" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sucursal_id" uuid NOT NULL,
	"insumo_id" uuid NOT NULL,
	"proveedor_id" uuid,
	"cantidad" numeric(12, 3) NOT NULL,
	"costo_total" numeric(10, 2) NOT NULL,
	"fecha" date NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cantidad_positiva" CHECK ("compra_insumo"."cantidad" > 0),
	CONSTRAINT "costo_no_negativo" CHECK ("compra_insumo"."costo_total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "conteo_insumo" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sucursal_id" uuid NOT NULL,
	"insumo_id" uuid NOT NULL,
	"tipo" "tipo_conteo" NOT NULL,
	"cantidad" numeric(12, 3) NOT NULL,
	"fecha" date NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conteo_unico_por_dia" UNIQUE("sucursal_id","insumo_id","tipo","fecha"),
	CONSTRAINT "cantidad_no_negativa" CHECK ("conteo_insumo"."cantidad" >= 0)
);
--> statement-breakpoint
CREATE TABLE "insumo" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"unidad" "unidad_medida" NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insumo_parametro" (
	"insumo_id" uuid NOT NULL,
	"sucursal_id" uuid NOT NULL,
	"stock_seguridad" numeric(12, 3) DEFAULT '0' NOT NULL,
	"dias_entrega" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "insumo_parametro_insumo_id_sucursal_id_pk" PRIMARY KEY("insumo_id","sucursal_id")
);
--> statement-breakpoint
CREATE TABLE "merma" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sucursal_id" uuid NOT NULL,
	"insumo_id" uuid NOT NULL,
	"cantidad" numeric(12, 3) NOT NULL,
	"motivo" text NOT NULL,
	"fecha" date NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cantidad_positiva" CHECK ("merma"."cantidad" > 0)
);
--> statement-breakpoint
CREATE TABLE "proveedor" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"contacto" text,
	"activo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dispositivo" ADD CONSTRAINT "dispositivo_sucursal_id_sucursal_id_fk" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mesa" ADD CONSTRAINT "mesa_sucursal_id_sucursal_id_fk" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_sucursal_id_sucursal_id_fk" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "producto" ADD CONSTRAINT "producto_categoria_id_categoria_id_fk" FOREIGN KEY ("categoria_id") REFERENCES "public"."categoria"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "producto_precio_historial" ADD CONSTRAINT "producto_precio_historial_producto_id_producto_id_fk" FOREIGN KEY ("producto_id") REFERENCES "public"."producto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "producto_precio_historial" ADD CONSTRAINT "producto_precio_historial_actor_id_usuario_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "producto_precio_sucursal" ADD CONSTRAINT "producto_precio_sucursal_producto_id_producto_id_fk" FOREIGN KEY ("producto_id") REFERENCES "public"."producto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "producto_precio_sucursal" ADD CONSTRAINT "producto_precio_sucursal_sucursal_id_sucursal_id_fk" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corte_caja" ADD CONSTRAINT "corte_caja_sucursal_id_sucursal_id_fk" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corte_caja" ADD CONSTRAINT "corte_caja_abierto_por_usuario_id_fk" FOREIGN KEY ("abierto_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corte_caja" ADD CONSTRAINT "corte_caja_cerrado_por_usuario_id_fk" FOREIGN KEY ("cerrado_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gasto" ADD CONSTRAINT "gasto_sucursal_id_sucursal_id_fk" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gasto" ADD CONSTRAINT "gasto_actor_id_usuario_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comanda" ADD CONSTRAINT "comanda_sucursal_id_sucursal_id_fk" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comanda" ADD CONSTRAINT "comanda_corte_caja_id_corte_caja_id_fk" FOREIGN KEY ("corte_caja_id") REFERENCES "public"."corte_caja"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comanda" ADD CONSTRAINT "comanda_mesa_id_mesa_id_fk" FOREIGN KEY ("mesa_id") REFERENCES "public"."mesa"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comanda" ADD CONSTRAINT "comanda_mesero_id_usuario_id_fk" FOREIGN KEY ("mesero_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comanda_detalle" ADD CONSTRAINT "comanda_detalle_comanda_id_comanda_id_fk" FOREIGN KEY ("comanda_id") REFERENCES "public"."comanda"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comanda_detalle" ADD CONSTRAINT "comanda_detalle_producto_id_producto_id_fk" FOREIGN KEY ("producto_id") REFERENCES "public"."producto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comanda_domicilio" ADD CONSTRAINT "comanda_domicilio_comanda_id_comanda_id_fk" FOREIGN KEY ("comanda_id") REFERENCES "public"."comanda"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comanda_evento" ADD CONSTRAINT "comanda_evento_comanda_id_comanda_id_fk" FOREIGN KEY ("comanda_id") REFERENCES "public"."comanda"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comanda_evento" ADD CONSTRAINT "comanda_evento_detalle_id_comanda_detalle_id_fk" FOREIGN KEY ("detalle_id") REFERENCES "public"."comanda_detalle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comanda_evento" ADD CONSTRAINT "comanda_evento_sucursal_id_sucursal_id_fk" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comanda_evento" ADD CONSTRAINT "comanda_evento_actor_id_usuario_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comanda_evento" ADD CONSTRAINT "comanda_evento_dispositivo_id_dispositivo_id_fk" FOREIGN KEY ("dispositivo_id") REFERENCES "public"."dispositivo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merma_producto" ADD CONSTRAINT "merma_producto_sucursal_id_sucursal_id_fk" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merma_producto" ADD CONSTRAINT "merma_producto_comanda_id_comanda_id_fk" FOREIGN KEY ("comanda_id") REFERENCES "public"."comanda"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merma_producto" ADD CONSTRAINT "merma_producto_detalle_id_comanda_detalle_id_fk" FOREIGN KEY ("detalle_id") REFERENCES "public"."comanda_detalle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merma_producto" ADD CONSTRAINT "merma_producto_producto_id_producto_id_fk" FOREIGN KEY ("producto_id") REFERENCES "public"."producto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merma_producto" ADD CONSTRAINT "merma_producto_actor_id_usuario_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pago" ADD CONSTRAINT "pago_comanda_id_comanda_id_fk" FOREIGN KEY ("comanda_id") REFERENCES "public"."comanda"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pago" ADD CONSTRAINT "pago_actor_id_usuario_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compra_insumo" ADD CONSTRAINT "compra_insumo_sucursal_id_sucursal_id_fk" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compra_insumo" ADD CONSTRAINT "compra_insumo_insumo_id_insumo_id_fk" FOREIGN KEY ("insumo_id") REFERENCES "public"."insumo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compra_insumo" ADD CONSTRAINT "compra_insumo_proveedor_id_proveedor_id_fk" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compra_insumo" ADD CONSTRAINT "compra_insumo_actor_id_usuario_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conteo_insumo" ADD CONSTRAINT "conteo_insumo_sucursal_id_sucursal_id_fk" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conteo_insumo" ADD CONSTRAINT "conteo_insumo_insumo_id_insumo_id_fk" FOREIGN KEY ("insumo_id") REFERENCES "public"."insumo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conteo_insumo" ADD CONSTRAINT "conteo_insumo_actor_id_usuario_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insumo_parametro" ADD CONSTRAINT "insumo_parametro_insumo_id_insumo_id_fk" FOREIGN KEY ("insumo_id") REFERENCES "public"."insumo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insumo_parametro" ADD CONSTRAINT "insumo_parametro_sucursal_id_sucursal_id_fk" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merma" ADD CONSTRAINT "merma_sucursal_id_sucursal_id_fk" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merma" ADD CONSTRAINT "merma_insumo_id_insumo_id_fk" FOREIGN KEY ("insumo_id") REFERENCES "public"."insumo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merma" ADD CONSTRAINT "merma_actor_id_usuario_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "corte_abierto_uq" ON "corte_caja" USING btree ("sucursal_id") WHERE "corte_caja"."estado" = 'abierto';--> statement-breakpoint
CREATE INDEX "gasto_periodo_idx" ON "gasto" USING btree ("sucursal_id","fecha");--> statement-breakpoint
CREATE UNIQUE INDEX "comanda_folio_uq" ON "comanda" USING btree ("sucursal_id","folio") WHERE "comanda"."folio" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "comanda_abiertas_idx" ON "comanda" USING btree ("sucursal_id","estado") WHERE "comanda"."estado" NOT IN ('cobrada', 'cancelada');--> statement-breakpoint
CREATE INDEX "comanda_corte_idx" ON "comanda" USING btree ("corte_caja_id");--> statement-breakpoint
CREATE INDEX "comanda_detalle_comanda_idx" ON "comanda_detalle" USING btree ("comanda_id");--> statement-breakpoint
CREATE INDEX "comanda_detalle_producto_idx" ON "comanda_detalle" USING btree ("producto_id");--> statement-breakpoint
CREATE INDEX "comanda_domicilio_tel_idx" ON "comanda_domicilio" USING btree ("telefono");--> statement-breakpoint
CREATE INDEX "comanda_evento_seq_idx" ON "comanda_evento" USING btree ("sucursal_id","seq");--> statement-breakpoint
CREATE INDEX "comanda_evento_comanda_idx" ON "comanda_evento" USING btree ("comanda_id","hlc");--> statement-breakpoint
CREATE INDEX "merma_producto_periodo_idx" ON "merma_producto" USING btree ("sucursal_id","fecha");--> statement-breakpoint
CREATE INDEX "merma_producto_prod_idx" ON "merma_producto" USING btree ("producto_id","fecha");--> statement-breakpoint
CREATE INDEX "pago_comanda_idx" ON "pago" USING btree ("comanda_id");--> statement-breakpoint
CREATE INDEX "compra_periodo_idx" ON "compra_insumo" USING btree ("sucursal_id","insumo_id","fecha");--> statement-breakpoint
CREATE INDEX "conteo_periodo_idx" ON "conteo_insumo" USING btree ("sucursal_id","insumo_id","fecha");--> statement-breakpoint
CREATE INDEX "merma_periodo_idx" ON "merma" USING btree ("sucursal_id","insumo_id","fecha");