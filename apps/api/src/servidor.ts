// Servidor de sincronización (2.5, ADR-005).
//
// El servidor NO empuja eventos por el socket: solo avisa "hay novedades" y el
// cliente jala. Un solo camino de entrega (el pull con cursor), imposible de
// perder en una reconexión.
import { pathToFileURL } from 'node:url';
import type { Writable } from 'node:stream';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import type { FastifyError, FastifyInstance } from 'fastify';
import { EsquemaPull, EsquemaPush } from '@lena/shared';
import type { MensajeServidor } from '@lena/shared';
import { crearDb } from './db';
import { capturarProceso, crearFlujoLog } from './log';
import { requiereSesion } from './auth/middleware';
import { registrarRutasAuth } from './auth/rutas';
import { registrarRutasGestion } from './admin/gestion';
import { registrarRutasAdmin } from './admin/reportes';
import { registrarRutasCatalogo } from './catalogo/rutas';
import { registrarRutasComandas } from './comandas/rutas';
import { registrarRutasInsumos } from './insumos/rutas';
import { registrarRutasTurno } from './turno/rutas';
import { procesarPull } from './sync/pull';
import { procesarPush } from './sync/push';

const CANAL = 'lena_sync';

export interface Servidor {
  app: FastifyInstance;
  cerrar(): Promise<void>;
}

export interface OpcionesServidor {
  // RS-T-7: 100 req/min por dispositivo, 10/min en auth. Los tests los suben
  // para no pelearse con el límite.
  limiteGlobal?: number;
  limiteAuth?: number;
  // Destino de los logs. Si se pasa, el servidor registra peticiones y errores
  // ahí; las pruebas no lo pasan y corren en silencio.
  logStream?: Writable;
}

export async function construirServidor(urlApp?: string, opts: OpcionesServidor = {}): Promise<Servidor> {
  const { db, sql } = crearDb(urlApp);
  const app = Fastify({
    logger: opts.logStream ? { level: process.env.LOG_LEVEL ?? 'info', stream: opts.logStream } : false,
  });

  // Todo error no controlado queda en el log con su stack (para resolverlo) y
  // el cliente recibe un 500 limpio; los errores de validación (4xx) pasan tal cual.
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const code = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (code >= 500) req.log.error({ err }, 'error no controlado');
    else req.log.warn({ err: err.message }, 'peticion rechazada');
    reply.code(code).send({ error: code >= 500 ? 'error_interno' : err.message });
  });
  await app.register(websocket);
  // Límite por IP. En el VPS, Caddy pone la IP real en X-Forwarded-For (RS-T-1).
  await app.register(rateLimit, {
    global: true,
    max: opts.limiteGlobal ?? 100,
    timeWindow: '1 minute',
  });

  // Sockets suscritos, agrupados por sucursal.
  const suscritos = new Map<string, Set<WebSocket>>();

  function avisar(sucursalId: string, seq: number): void {
    const sockets = suscritos.get(sucursalId);
    if (!sockets) return;
    const msg: MensajeServidor = { tipo: 'hay_novedades', sucursalId, seq };
    const texto = JSON.stringify(msg);
    for (const s of sockets) {
      // readyState 1 = OPEN
      if (s.readyState === 1) s.send(texto);
    }
  }

  // Una conexión dedicada escucha los NOTIFY y reparte a los sockets. Este es
  // el único puente entre lo que pasa en la base y los clientes conectados.
  const listen = await sql.listen(CANAL, (payload) => {
    try {
      const { sucursalId, seq } = JSON.parse(payload) as { sucursalId: string; seq: number };
      avisar(sucursalId, seq);
    } catch {
      // Un NOTIFY con basura no debe tumbar el servidor.
    }
  });

  app.get('/health', async () => ({ ok: true }));

  registrarRutasAuth(app, db, opts.limiteAuth ?? 10);
  registrarRutasCatalogo(app, db);
  registrarRutasComandas(app, db);
  registrarRutasTurno(app, db);
  registrarRutasAdmin(app, db);
  registrarRutasGestion(app, db);
  registrarRutasInsumos(app, db);

  app.post('/sync/push', { preHandler: requiereSesion }, async (req, reply) => {
    const parsed = EsquemaPush.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'peticion_invalida', detalle: parsed.error.issues });
    }
    // RS-Z-2: la sucursal sale de la sesión, no del cliente. El admin (global)
    // no se restringe; mesero/cocina solo empujan lo de su sucursal (RS-Z-6).
    const sucursalPermitida = req.sesion?.sucursalId ?? undefined;
    const r = await procesarPush(db, parsed.data, { sucursalPermitida });

    // Avisar a la(s) sucursal(es) tocada(s). El NOTIFY viaja por Postgres, así
    // que también llega a otras instancias del API (multi-proceso).
    const sucursales = new Set(parsed.data.eventos.map((e) => e.sucursalId));
    for (const sucursalId of sucursales) {
      await sql`SELECT pg_notify(${CANAL}, ${JSON.stringify({ sucursalId, seq: r.seq })})`;
    }
    return r;
  });

  app.get('/sync/pull', { preHandler: requiereSesion }, async (req, reply) => {
    const parsed = EsquemaPull.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'peticion_invalida', detalle: parsed.error.issues });
    }
    // RS-Z-3: un dispositivo solo jala eventos de su sucursal. Se ignora el
    // sucursalId del cliente y se usa el de la sesión (el admin sí puede pedir).
    const sucursalId = req.sesion?.sucursalId ?? parsed.data.sucursalId;
    return procesarPull(db, { ...parsed.data, sucursalId });
  });

  app.get('/sync/ws', { websocket: true }, (socket) => {
    const ws = socket as unknown as WebSocket;
    let sucursal: string | null = null;

    ws.addEventListener('message', (ev: MessageEvent) => {
      let msg: { tipo?: string; sucursalId?: string };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.tipo === 'suscribir' && msg.sucursalId) {
        sucursal = msg.sucursalId;
        const set = suscritos.get(sucursal) ?? new Set();
        set.add(ws);
        suscritos.set(sucursal, set);
      } else if (msg.tipo === 'ping') {
        const pong: MensajeServidor = { tipo: 'pong' };
        ws.send(JSON.stringify(pong));
      }
    });

    ws.addEventListener('close', () => {
      if (sucursal) suscritos.get(sucursal)?.delete(ws);
    });
  });

  return {
    app,
    async cerrar() {
      await listen.unlisten();
      await app.close();
      await sql.end();
    },
  };
}

// Arranque directo: node/tsx src/servidor.ts. pathToFileURL normaliza la ruta
// de Windows (backslashes) para que el guard no falle en local.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const puerto = Number(process.env.API_PORT ?? 3000);
  const flujo = crearFlujoLog();
  capturarProceso(flujo); // registra también los crashes fuera de Fastify
  const srv = await construirServidor(undefined, { logStream: flujo });
  await srv.app.listen({ port: puerto, host: '0.0.0.0' });
  srv.app.log.info(`API de sincronización en :${puerto}`);
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, async () => {
      await srv.cerrar();
      process.exit(0);
    });
  }
}
