// Reportes de gestión (RF-I, RF-H-9). Solo lectura (excepto crear gasto).
// El superadmin ve todas las sucursales (o filtra por una); el administrador
// queda acotado a la suya SIEMPRE (sucursalScope). Ver 07 §roles.
import { randomUUID } from 'node:crypto';
import { desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { aCentavos, aPesos } from '@lena/shared';
import { dispositivo, gasto } from '@lena/db';
import type { Db } from '../db';
import { requiereRol } from '../auth/middleware';
import { sucursalScope } from './scope';

const soloAdmin = { preHandler: requiereRol('superadmin', 'administrador') };

// CSV mínimo y seguro: comillas y saltos escapados. RS-P-7: los reportes de
// aquí NO llevan datos de cliente (nombre/teléfono/dirección).
function aCsv(encabezados: string[], filas: (string | number)[][]): string {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [encabezados, ...filas].map((f) => f.map(esc).join(',')).join('\n');
}

function pesos(centavos: number): string {
  return (centavos / 100).toFixed(2);
}

// Rango de fechas [desde, hasta] inclusive, por defecto hoy (zona MX).
const EsqRango = z.object({
  desde: z.string().optional(),
  hasta: z.string().optional(),
  sucursalId: z.string().uuid().optional(),
});

function rango(req: FastifyRequest): { desde: string; hasta: string; sucursalId?: string } {
  const p = EsqRango.parse(req.query ?? {});
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
  // El administrador queda acotado a su sucursal; el superadmin filtra o ve todo.
  const sucursalId = sucursalScope(req, p.sucursalId);
  return { desde: p.desde ?? hoy, hasta: p.hasta ?? hoy, ...(sucursalId ? { sucursalId } : {}) };
}

// Filtro de sucursal reutilizable (o nada si el admin no filtra).
function filtroSucursal(col: string, sucursalId?: string) {
  return sucursalId ? sql` AND ${sql.raw(col)} = ${sucursalId}` : sql``;
}

export function registrarRutasAdmin(app: FastifyInstance, db: Db): void {
  // ── Resumen del periodo (RF-I-1) ──
  app.get('/admin/resumen', soloAdmin, async (req) => {
    const { desde, hasta, sucursalId } = rango(req);
    const [venta] = (await db.execute(sql`
      SELECT coalesce(sum(total), 0) AS ventas, count(*) AS comandas
      FROM comanda
      WHERE estado = 'cobrada'
        AND (cerrada_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN ${desde} AND ${hasta}
        ${filtroSucursal('sucursal_id', sucursalId)}
    `)) as unknown as { ventas: string; comandas: string }[];
    const [merma] = (await db.execute(sql`
      SELECT coalesce(sum(costo_estimado), 0) AS merma
      FROM merma_producto
      WHERE fecha BETWEEN ${desde} AND ${hasta}
        ${filtroSucursal('sucursal_id', sucursalId)}
    `)) as unknown as { merma: string }[];

    const ventas = aCentavos(venta?.ventas ?? '0');
    const comandas = Number(venta?.comandas ?? 0);
    return {
      ventas,
      comandas,
      ticket: comandas > 0 ? Math.round(ventas / comandas) : 0,
      merma: aCentavos(merma?.merma ?? '0'),
    };
  });

  // ── Merma y cancelaciones por mesero — la mitigación de T1 (09 §7.1) ──
  app.get('/admin/merma', soloAdmin, async (req) => {
    const { desde, hasta, sucursalId } = rango(req);

    // Por mesero: comandas, canceladas, tasa, merma. "vs equipo" se calcula
    // después con el promedio. El fraude no se ve en el evento, sino en el patrón.
    const porMesero = (await db.execute(sql`
      SELECT u.id, u.nombre,
        count(c.id) FILTER (WHERE c.estado = 'cobrada' OR c.estado = 'cancelada') AS comandas,
        count(c.id) FILTER (WHERE c.estado = 'cancelada') AS canceladas,
        coalesce((
          SELECT sum(m.costo_estimado) FROM merma_producto m
          WHERE m.actor_id = u.id AND m.fecha BETWEEN ${desde} AND ${hasta}
        ), 0) AS merma
      FROM usuario u
      LEFT JOIN comanda c ON c.mesero_id = u.id
        AND (c.cerrada_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN ${desde} AND ${hasta}
        ${filtroSucursal('c.sucursal_id', sucursalId)}
      WHERE u.rol = 'mesero'
      GROUP BY u.id, u.nombre
      HAVING count(c.id) > 0
      ORDER BY canceladas DESC
    `)) as unknown as { id: string; nombre: string; comandas: string; canceladas: string; merma: string }[];

    const filas = porMesero.map((m) => {
      const comandas = Number(m.comandas);
      const canceladas = Number(m.canceladas);
      return {
        id: m.id,
        nombre: m.nombre,
        comandas,
        canceladas,
        tasa: comandas > 0 ? canceladas / comandas : 0,
        merma: aCentavos(m.merma),
      };
    });
    // vs equipo: tasa de cada uno contra el promedio del equipo.
    const tasaPromedio = filas.length ? filas.reduce((s, f) => s + f.tasa, 0) / filas.length : 0;
    const meseros = filas.map((f) => ({
      ...f,
      vsEquipo: tasaPromedio > 0 ? f.tasa / tasaPromedio : 0,
    }));

    // Por producto (RF-I-10).
    const porProducto = (await db.execute(sql`
      SELECT nombre_producto, sum(cantidad) AS cantidad, sum(costo_estimado) AS costo
      FROM merma_producto
      WHERE fecha BETWEEN ${desde} AND ${hasta} ${filtroSucursal('sucursal_id', sucursalId)}
      GROUP BY nombre_producto ORDER BY costo DESC
    `)) as unknown as { nombre_producto: string; cantidad: string; costo: string }[];

    const total = meseros.reduce((s, m) => s + m.merma, 0);
    return {
      total,
      meseros,
      productos: porProducto.map((p) => ({
        nombre: p.nombre_producto,
        cantidad: Number(p.cantidad),
        costo: aCentavos(p.costo),
      })),
    };
  });

  // ── Comandas canceladas con motivo, autor y costo (RF-I-9) ──
  app.get('/admin/canceladas', soloAdmin, async (req) => {
    const { desde, hasta, sucursalId } = rango(req);
    const filas = (await db.execute(sql`
      SELECT c.id, c.folio, u.nombre AS mesero, c.cerrada_at, c.motivo_cancelacion,
        coalesce((SELECT sum(m.costo_estimado) FROM merma_producto m WHERE m.comanda_id = c.id), 0) AS costo
      FROM comanda c JOIN usuario u ON u.id = c.mesero_id
      WHERE c.estado = 'cancelada'
        AND (c.cerrada_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN ${desde} AND ${hasta}
        ${filtroSucursal('c.sucursal_id', sucursalId)}
      ORDER BY c.cerrada_at DESC
    `)) as unknown as {
      id: string;
      folio: number | null;
      mesero: string;
      cerrada_at: string;
      motivo_cancelacion: string | null;
      costo: string;
    }[];
    return filas.map((f) => ({
      id: f.id,
      folio: f.folio,
      mesero: f.mesero,
      momento: f.cerrada_at,
      motivo: f.motivo_cancelacion,
      costoMermado: aCentavos(f.costo),
    }));
  });

  // ── Ventas por hora (RF-I-3) ──
  app.get('/admin/ventas-por-hora', soloAdmin, async (req) => {
    const { desde, hasta, sucursalId } = rango(req);
    const filas = (await db.execute(sql`
      SELECT extract(hour FROM c.cerrada_at AT TIME ZONE 'America/Mexico_City')::int AS hora,
        coalesce(sum(c.total), 0) AS ventas, count(*) AS comandas
      FROM comanda c
      WHERE c.estado = 'cobrada'
        AND (c.cerrada_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN ${desde} AND ${hasta}
        ${filtroSucursal('c.sucursal_id', sucursalId)}
      GROUP BY hora ORDER BY hora
    `)) as unknown as { hora: number; ventas: string; comandas: string }[];
    return filas.map((f) => ({ hora: f.hora, ventas: aCentavos(f.ventas), comandas: Number(f.comandas) }));
  });

  // ── Más vendidos (RF-I-6) ──
  app.get('/admin/mas-vendidos', soloAdmin, async (req) => {
    const { desde, hasta, sucursalId } = rango(req);
    const filas = (await db.execute(sql`
      SELECT d.nombre_producto, sum(d.cantidad) AS unidades, sum(d.cantidad * d.precio_unitario) AS importe
      FROM comanda_detalle d JOIN comanda c ON c.id = d.comanda_id
      WHERE c.estado = 'cobrada' AND d.estado <> 'cancelada'
        AND (c.cerrada_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN ${desde} AND ${hasta}
        ${filtroSucursal('c.sucursal_id', sucursalId)}
      GROUP BY d.nombre_producto ORDER BY unidades DESC LIMIT 20
    `)) as unknown as { nombre_producto: string; unidades: string; importe: string }[];
    return filas.map((f) => ({
      nombre: f.nombre_producto,
      unidades: Number(f.unidades),
      importe: aCentavos(f.importe),
    }));
  });

  // ── Historial de cortes (RF-H-9) ──
  app.get('/admin/cortes', soloAdmin, async (req) => {
    const { desde, hasta, sucursalId } = rango(req);
    const filas = (await db.execute(sql`
      SELECT id, sucursal_id, estado, fondo_inicial, esperado_efectivo, contado_efectivo,
        diferencia, total_tarjeta, total_transferencia, abierto_at, cerrado_at
      FROM corte_caja
      WHERE estado = 'cerrado'
        AND (cerrado_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN ${desde} AND ${hasta}
        ${filtroSucursal('sucursal_id', sucursalId)}
      ORDER BY cerrado_at DESC
    `)) as unknown as Record<string, string | null>[];
    return filas.map((c) => ({
      id: c.id,
      sucursalId: c.sucursal_id,
      fondoInicial: aCentavos(c.fondo_inicial ?? '0'),
      esperado: aCentavos(c.esperado_efectivo ?? '0'),
      contado: aCentavos(c.contado_efectivo ?? '0'),
      diferencia: aCentavos(c.diferencia ?? '0'),
      tarjeta: aCentavos(c.total_tarjeta ?? '0'),
      transferencia: aCentavos(c.total_transferencia ?? '0'),
      cerradoAt: c.cerrado_at,
    }));
  });

  // ── Gastos (RF-I-4) + ingresos vs gastos (RF-I-5) ──
  app.get('/admin/gastos', soloAdmin, async (req) => {
    const { desde, hasta, sucursalId } = rango(req);
    const filas = (await db.execute(sql`
      SELECT id, categoria, concepto, monto, fecha FROM gasto
      WHERE fecha BETWEEN ${desde} AND ${hasta} ${filtroSucursal('sucursal_id', sucursalId)}
      ORDER BY fecha DESC
    `)) as unknown as { id: string; categoria: string; concepto: string; monto: string; fecha: string }[];
    return filas.map((g) => ({ ...g, monto: aCentavos(g.monto) }));
  });

  app.post('/admin/gastos', soloAdmin, async (req, reply) => {
    const p = z
      .object({
        sucursalId: z.string().uuid().optional(),
        categoria: z.enum(['insumo', 'servicio', 'sueldo', 'renta', 'otro']),
        concepto: z.string().trim().min(1),
        monto: z.number().int().positive(),
        fecha: z.string(),
      })
      .safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'peticion_invalida' });
    // El administrador solo registra gastos en SU sucursal; el superadmin elige.
    const sucursalId = sucursalScope(req, p.data.sucursalId);
    if (!sucursalId) return reply.code(400).send({ error: 'sucursal_requerida' });
    const [g] = await db
      .insert(gasto)
      .values({
        id: randomUUID(),
        sucursalId,
        categoria: p.data.categoria,
        concepto: p.data.concepto,
        monto: aPesos(p.data.monto),
        fecha: p.data.fecha,
        actorId: req.sesion?.usuarioId as string,
      })
      .returning({ id: gasto.id });
    return { id: g?.id };
  });

  app.get('/admin/ingresos-vs-gastos', soloAdmin, async (req) => {
    const { desde, hasta, sucursalId } = rango(req);
    const [ing] = (await db.execute(sql`
      SELECT coalesce(sum(total), 0) AS ingresos FROM comanda
      WHERE estado = 'cobrada'
        AND (cerrada_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN ${desde} AND ${hasta}
        ${filtroSucursal('sucursal_id', sucursalId)}
    `)) as unknown as { ingresos: string }[];
    const [gas] = (await db.execute(sql`
      SELECT coalesce(sum(monto), 0) AS gastos FROM gasto
      WHERE fecha BETWEEN ${desde} AND ${hasta} ${filtroSucursal('sucursal_id', sucursalId)}
    `)) as unknown as { gastos: string }[];
    const ingresos = aCentavos(ing?.ingresos ?? '0');
    const gastos = aCentavos(gas?.gastos ?? '0');
    return { ingresos, gastos, balance: ingresos - gastos };
  });

  // ── Estado de sincronización de dispositivos (RNF-O-5) ──
  // El fallo más peligroso: una tablet que cree sincronizar y no lo hace. Se
  // ve normal, el mesero trabaja tranquilo, y sus comandas no existen para nadie.
  app.get('/admin/dispositivos', soloAdmin, async (req) => {
    const suc = sucursalScope(req);
    const filas = await db
      .select()
      .from(dispositivo)
      .where(suc ? eq(dispositivo.sucursalId, suc) : undefined)
      .orderBy(desc(dispositivo.ultimaSyncAt));
    const ahora = Date.now();
    return filas.map((d) => ({
      id: d.id,
      nombre: d.nombre,
      letra: d.letra,
      activo: d.activo,
      ultimaSyncAt: d.ultimaSyncAt,
      minutosSinSync: d.ultimaSyncAt ? Math.floor((ahora - d.ultimaSyncAt.getTime()) / 60_000) : null,
    }));
  });

  // ── Caja del día por sucursal (RF-H, "venta del día") ──
  // Estado de hoy por sucursal en alcance: venta cobrada, si el turno está
  // abierto, y cuántas comandas quedan sin cobrar. El turno se abre/cierra en
  // la tablet de la sucursal (la caja es física); aquí el gestor lo observa.
  app.get('/admin/caja', soloAdmin, async (req) => {
    const suc = sucursalScope(req);
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
    const filas = (await db.execute(sql`
      SELECT s.id, s.nombre,
        coalesce((SELECT sum(c.total) FROM comanda c
          WHERE c.sucursal_id = s.id AND c.estado = 'cobrada'
            AND (c.cerrada_at AT TIME ZONE 'America/Mexico_City')::date = ${hoy}), 0) AS ventas,
        coalesce((SELECT count(*) FROM comanda c
          WHERE c.sucursal_id = s.id AND c.estado = 'cobrada'
            AND (c.cerrada_at AT TIME ZONE 'America/Mexico_City')::date = ${hoy}), 0) AS comandas,
        (SELECT count(*) FROM comanda c
          WHERE c.sucursal_id = s.id AND c.estado NOT IN ('cobrada', 'cancelada')) AS abiertas,
        cc.abierto_at, cc.fondo_inicial
      FROM sucursal s
      LEFT JOIN corte_caja cc ON cc.sucursal_id = s.id AND cc.estado = 'abierto'
      WHERE s.activo = true ${suc ? sql`AND s.id = ${suc}` : sql``}
      ORDER BY s.nombre
    `)) as unknown as {
      id: string;
      nombre: string;
      ventas: string;
      comandas: string;
      abiertas: string;
      abierto_at: string | null;
      fondo_inicial: string | null;
    }[];
    return filas.map((f) => ({
      sucursalId: f.id,
      sucursal: f.nombre,
      ventas: aCentavos(f.ventas),
      comandas: Number(f.comandas),
      comandasAbiertas: Number(f.abiertas),
      turnoAbierto: f.abierto_at !== null,
      abiertoAt: f.abierto_at,
      fondoInicial: f.fondo_inicial ? aCentavos(f.fondo_inicial) : null,
    }));
  });

  // ── Comandas del día (para la Caja del día) ──
  // Lista de hoy por sucursal en alcance; se abre el detalle con /admin/comandas/:id.
  app.get('/admin/comandas-dia', soloAdmin, async (req) => {
    const suc = sucursalScope(req);
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
    const filas = (await db.execute(sql`
      SELECT c.id, c.folio, c.tipo_servicio, c.estado, c.total, c.abierta_at, c.cerrada_at,
        m.nombre AS mesa, u.nombre AS mesero, s.nombre AS sucursal
      FROM comanda c
      LEFT JOIN mesa m ON m.id = c.mesa_id
      LEFT JOIN usuario u ON u.id = c.mesero_id
      JOIN sucursal s ON s.id = c.sucursal_id
      WHERE (c.abierta_at AT TIME ZONE 'America/Mexico_City')::date = ${hoy}
        ${suc ? sql`AND c.sucursal_id = ${suc}` : sql``}
      ORDER BY c.abierta_at DESC
    `)) as unknown as Record<string, string | null>[];
    return filas.map((c) => ({
      id: c.id,
      folio: c.folio ? Number(c.folio) : null,
      tipoServicio: c.tipo_servicio,
      estado: c.estado,
      total: aCentavos(c.total ?? '0'),
      mesa: c.mesa,
      mesero: c.mesero,
      sucursal: c.sucursal,
      abiertaAt: c.abierta_at,
      cerradaAt: c.cerrada_at,
    }));
  });

  // Detalle de una comanda (líneas + pagos). Acotado a la sucursal del admin.
  app.get<{ Params: { id: string } }>('/admin/comandas/:id', soloAdmin, async (req, reply) => {
    const suc = sucursalScope(req);
    const [cab] = (await db.execute(sql`
      SELECT c.id, c.folio, c.tipo_servicio, c.estado, c.total, c.sucursal_id, c.motivo_cancelacion,
        c.abierta_at, c.cerrada_at, m.nombre AS mesa, u.nombre AS mesero
      FROM comanda c
      LEFT JOIN mesa m ON m.id = c.mesa_id
      LEFT JOIN usuario u ON u.id = c.mesero_id
      WHERE c.id = ${req.params.id}
    `)) as unknown as Record<string, string | null>[];
    if (!cab) return reply.code(404).send({ error: 'no_encontrada' });
    if (suc && cab.sucursal_id !== suc) return reply.code(403).send({ error: 'sucursal_ajena' });

    const lineas = (await db.execute(sql`
      SELECT nombre_producto, cantidad, precio_unitario, estado, notas
      FROM comanda_detalle WHERE comanda_id = ${req.params.id} ORDER BY created_at
    `)) as unknown as Record<string, string | null>[];
    const pagos = (await db.execute(sql`
      SELECT metodo, monto FROM pago WHERE comanda_id = ${req.params.id} ORDER BY created_at
    `)) as unknown as Record<string, string>[];

    return {
      id: cab.id,
      folio: cab.folio ? Number(cab.folio) : null,
      tipoServicio: cab.tipo_servicio,
      estado: cab.estado,
      total: aCentavos(cab.total ?? '0'),
      mesa: cab.mesa,
      mesero: cab.mesero,
      motivoCancelacion: cab.motivo_cancelacion,
      abiertaAt: cab.abierta_at,
      cerradaAt: cab.cerrada_at,
      lineas: lineas.map((l) => ({
        nombre: l.nombre_producto,
        cantidad: Number(l.cantidad),
        precio: aCentavos(l.precio_unitario ?? '0'),
        estado: l.estado,
        notas: l.notas,
      })),
      pagos: pagos.map((p) => ({ metodo: p.metodo, monto: aCentavos(p.monto ?? '0') })),
    };
  });

  // ── Exportar a CSV (RF-I-8) ──
  app.get<{ Params: { reporte: string } }>('/admin/export/:reporte', soloAdmin, async (req, reply) => {
    const { desde, hasta, sucursalId } = rango(req);

    if (req.params.reporte === 'canceladas') {
      const filas = (await db.execute(sql`
        SELECT c.folio, u.nombre AS mesero, c.cerrada_at, c.motivo_cancelacion,
          coalesce((SELECT sum(m.costo_estimado) FROM merma_producto m WHERE m.comanda_id = c.id), 0) AS costo
        FROM comanda c JOIN usuario u ON u.id = c.mesero_id
        WHERE c.estado = 'cancelada'
          AND (c.cerrada_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN ${desde} AND ${hasta}
          ${filtroSucursal('c.sucursal_id', sucursalId)}
        ORDER BY c.cerrada_at DESC
      `)) as unknown as {
        folio: number | null;
        mesero: string;
        cerrada_at: string;
        motivo_cancelacion: string | null;
        costo: string;
      }[];
      const csv = aCsv(
        ['folio', 'mesero', 'momento', 'motivo', 'costo_mermado'],
        filas.map((f) => [
          f.folio ?? '',
          f.mesero,
          f.cerrada_at,
          f.motivo_cancelacion ?? '',
          pesos(aCentavos(f.costo)),
        ]),
      );
      return reply.header('content-type', 'text/csv; charset=utf-8').send(csv);
    }

    if (req.params.reporte === 'merma-meseros') {
      const filas = (await db.execute(sql`
        SELECT u.nombre,
          count(c.id) FILTER (WHERE c.estado IN ('cobrada','cancelada')) AS comandas,
          count(c.id) FILTER (WHERE c.estado = 'cancelada') AS canceladas,
          coalesce((SELECT sum(m.costo_estimado) FROM merma_producto m WHERE m.actor_id = u.id AND m.fecha BETWEEN ${desde} AND ${hasta}), 0) AS merma
        FROM usuario u
        LEFT JOIN comanda c ON c.mesero_id = u.id
          AND (c.cerrada_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN ${desde} AND ${hasta}
          ${filtroSucursal('c.sucursal_id', sucursalId)}
        WHERE u.rol = 'mesero' GROUP BY u.id, u.nombre HAVING count(c.id) > 0 ORDER BY canceladas DESC
      `)) as unknown as { nombre: string; comandas: string; canceladas: string; merma: string }[];
      const csv = aCsv(
        ['mesero', 'comandas', 'canceladas', 'tasa', 'merma'],
        filas.map((f) => {
          const c = Number(f.comandas);
          const x = Number(f.canceladas);
          return [f.nombre, c, x, c > 0 ? (x / c).toFixed(4) : '0', pesos(aCentavos(f.merma))];
        }),
      );
      return reply.header('content-type', 'text/csv; charset=utf-8').send(csv);
    }

    return reply.code(404).send({ error: 'reporte_desconocido' });
  });
}
