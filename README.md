# 🔥 Leña

Sistema de comandas y gestión para restaurantes pequeños.
Web responsiva, **offline-first**, multi-sucursal.

> **Estado:** MVP funcional (fases 0–9). API (Fastify + sync offline), PWA (mesero/cocina/gestión) y base completos y probados. Falta piloto en tablet física (fase 9.2) y la Fase 2 del producto (insumos/compra sugerida).
>
> **Roles:** **superadmin** (dueño, global: crea sucursales y administradores) · **administrador** (gerente de una sucursal: reportes, caja/turno, usuarios, gastos) · **mesero** · **cocina**. Ver [`Docs/07` §4.1](./Docs/7.-Requisitos%20de%20seguridad.md).

## Documentación

**Toda decisión de este proyecto está justificada en [`Docs/`](./Docs/0.-Indice.md).** Si algo del código parece raro, la razón está ahí.

| | |
|---|---|
| [00. Índice](./Docs/0.-Indice.md) | **Empieza aquí** |
| [02. Arquitectura](./Docs/2.-Arquitectura.md) | Los 7 ADR y por qué |
| [04. Modelo de datos](./Docs/4.-Modelo%20de%20datos.md) | El espejo de `packages/db` |
| [10. Cronograma](./Docs/10.-Cronograma%20de%20desarrollo.md) | Qué sigue |

### Las decisiones que explican el código

- **El estado de la comanda es un log de eventos, no un campo mutable** (ADR-002). Los `INSERT` no chocan; los `UPDATE` sí. Con dispositivos escribiendo sin red, esto elimina la peor clase de bug por construcción.
- **El dinero histórico es inmutable** (ADR-006). `comanda_detalle` guarda **copia** del precio y del nombre. Jamás se hace `JOIN` a `producto` para calcular un total.
- **El log es el control antifraude** (`07` §1). La amenaza #1 de un POS no es un hacker: es un empleado cobrando en efectivo y cancelando en el sistema. Por eso `UPDATE`/`DELETE` están revocados en Postgres, no solo prohibidos por convención.
- **Las tablas de Fase 2 existen desde hoy.** El motor de compra sugerida necesita semanas de historial; si no se guarda desde el día 1, arranca sin nada que aprender.

## Requisitos

| | |
|---|---|
| Node | ≥ 22 |
| pnpm | 9 (`npm i -g pnpm`) |
| Docker | Para Postgres |

## Arranque

```bash
pnpm install
cp .env.example .env                 # en Windows PowerShell: copy .env.example .env
pnpm db:up                           # levanta Postgres en Docker (puerto 5434)
pnpm db:migrate                      # crea el esquema
pnpm db:seed                         # 2 sucursales + datos de prueba
pnpm --filter @lena/api seed:auth    # credenciales dev con hashes reales

pnpm --filter @lena/api dev          # API en :3000  (deja esta terminal)
pnpm --filter @lena/pwa dev          # PWA en :5173  (otra terminal)
```

Abre **http://127.0.0.1:5173**. Guía completa (demo, LAN, producción): [`Docs/13`](./Docs/13.-Guia%20de%20ejecucion%20local%20y%20demo.md).

### Cómo entrar (dev)

| Quién | Cómo | Credenciales |
|---|---|---|
| **Mesero / Cocina** | Clave de sucursal → usuario → PIN | Clave **CENTRO** · Ana **481920** · Luis **481922** · Miguel (cocina) **481921** |
| **Dueño** (superadmin) | "Soy dueño o administrador" | **super@lena.local** / **ClaveSuper2026x** |
| **Administrador** (Centro) | idem | **admin@lena.local** / **ClaveAdmin2026x** |

El **turno de caja** lo abre/cierra el administrador (en *Inicio*), no el mesero. La **clave de sucursal** se ve en el panel de gestión y se genera al dar de alta una sucursal.

## Comandos

| | |
|---|---|
| `pnpm db:up` / `db:down` | Levanta / baja Postgres |
| `pnpm db:reset` | ⚠️ **Borra los datos** y vuelve a levantar |
| `pnpm db:generate` | Genera la migración SQL desde el esquema Drizzle |
| `pnpm db:migrate` | Aplica las migraciones pendientes |
| `pnpm db:seed` | Datos de prueba (falla en producción) |
| `pnpm check` | typecheck + lint + tests |

## Estructura

```
lena/
├── Docs/           Documentación. La fuente de verdad del "por qué"
├── packages/
│   ├── db/         Esquema Drizzle + migraciones
│   └── shared/     (fase 1) Proyector de estado, HLC, tipos
└── apps/
    ├── api/        Fastify + WebSocket + sync + auth + gestión
    └── pwa/        PWA React (mesero, cocina, escritorio de gestión)
```

`packages/shared` va a contener la lógica que **no puede divergir** entre cliente y servidor: las transiciones de estado y el cálculo de totales. Si el cliente y el servidor no concuerdan en si una transición es legal, el sync produce estados imposibles.

## Base de datos

El **esquema Drizzle es la fuente de verdad**. Las migraciones se generan de él:

```bash
# 1. Editas packages/db/src/schema/*.ts
# 2. Generas la migración
pnpm db:generate
# 3. La aplicas
pnpm db:migrate
```

**Las migraciones nunca se editan a mano** — divergirían del esquema y Drizzle dejaría de saber en qué estado está la base. La excepción son las migraciones `--custom` (roles, `REVOKE`, vistas), que Drizzle no puede generar.

### Dos roles, a propósito

| Rol | Uso |
|---|---|
| `lena` | Dueño. Migraciones y respaldos. **Nunca el API** |
| `lena_app` | El API. Sin `UPDATE`/`DELETE` en las tablas de auditoría |

Un `REVOKE` sobre el dueño de una tabla no protege nada: el dueño se re-otorga permisos solo. **Esa separación es lo que hace real al log append-only.**

## Hardware objetivo

**Samsung Galaxy Tab A11** · 8.7" · 1340×800 · `dpr` **2.0** · Android 11 · Chrome

| | Viewport CSS |
|---|---|
| Mesero (vertical) | **400 × 670** |
| Cocina (horizontal) | **670 × 400** |

**El lienzo de 400×670 es la restricción que manda sobre el diseño.** Lo que no quepa ahí no existe.

## Licencia

Propietario. Todos los derechos reservados.
