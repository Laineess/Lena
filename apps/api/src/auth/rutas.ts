// Rutas de autenticación (fase 3).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db';
import { requiereRol } from './middleware';
import {
  loginAdmin,
  loginPin,
  logout,
  refrescar,
  registrarDispositivo,
  revocarDispositivo,
} from './servicio';

const EsqAdmin = z.object({ email: z.string().email(), password: z.string().min(1) });
const EsqPin = z.object({
  dispositivoId: z.string().uuid(),
  tokenDispositivo: z.string().min(1),
  usuarioId: z.string().uuid(),
  pin: z.string().min(1),
});
const EsqRefresh = z.object({ refresh: z.string().min(1).optional() });
const EsqDispositivo = z.object({
  sucursalId: z.string().uuid(),
  nombre: z.string().min(1),
  letra: z.string().min(1).max(2),
});

const COOKIE = 'lena_refresh';

// Refresh en cookie HttpOnly+Secure+SameSite=Strict (RS-A-12). Se manda también
// en el cuerpo para clientes que no son navegador (la tablet guarda el token).
function cookieRefresh(token: string): string {
  return `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/auth; Max-Age=2592000`;
}

function leerRefresh(req: { headers: Record<string, unknown>; body: unknown }): string | null {
  const body = (req.body ?? {}) as { refresh?: string };
  if (body.refresh) return body.refresh;
  const cookie = String(req.headers.cookie ?? '');
  const m = cookie.match(new RegExp(`${COOKIE}=([^;]+)`));
  return m?.[1] ?? null;
}

export function registrarRutasAuth(app: FastifyInstance, db: Db, limiteAuth = 10): void {
  // RS-T-7: endpoints de autenticación con límite estricto (10/min por IP).
  const limite = { config: { rateLimit: { max: limiteAuth, timeWindow: '1 minute' } } };

  app.post('/auth/login/admin', limite, async (req, reply) => {
    const p = EsqAdmin.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'peticion_invalida' });
    const r = await loginAdmin(db, { ...p.data, ip: req.ip });
    if (!r.ok) return reply.code(401).send({ error: r.motivo });
    reply.header('set-cookie', cookieRefresh(r.refresh));
    return { acceso: r.acceso, refresh: r.refresh, sesion: r.sesion };
  });

  app.post('/auth/login/pin', limite, async (req, reply) => {
    const p = EsqPin.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'peticion_invalida' });
    const r = await loginPin(db, { ...p.data, ip: req.ip });
    if (!r.ok) return reply.code(401).send({ error: r.motivo, bloqueadoHasta: r.bloqueadoHasta });
    reply.header('set-cookie', cookieRefresh(r.refresh));
    return { acceso: r.acceso, refresh: r.refresh, sesion: r.sesion };
  });

  app.post('/auth/refresh', async (req, reply) => {
    if (!EsqRefresh.safeParse(req.body ?? {}).success) return reply.code(400).send({ error: 'peticion_invalida' });
    const refresh = leerRefresh(req);
    if (!refresh) return reply.code(401).send({ error: 'sin_refresh' });
    const r = await refrescar(db, { refresh, ip: req.ip });
    if (!r.ok) return reply.code(401).send({ error: r.motivo });
    reply.header('set-cookie', cookieRefresh(r.refresh));
    return { acceso: r.acceso, refresh: r.refresh, sesion: r.sesion };
  });

  app.post('/auth/logout', async (req, reply) => {
    const refresh = leerRefresh(req);
    if (refresh) await logout(db, refresh);
    reply.header('set-cookie', `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/auth; Max-Age=0`);
    return { ok: true };
  });

  // Solo el administrador registra/revoca dispositivos (RS-A-9).
  app.post('/auth/dispositivos', { preHandler: requiereRol('administrador') }, async (req, reply) => {
    const p = EsqDispositivo.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'peticion_invalida' });
    // El token se devuelve UNA vez; después solo vive su hash.
    return registrarDispositivo(db, p.data);
  });

  app.delete<{ Params: { id: string } }>(
    '/auth/dispositivos/:id',
    { preHandler: requiereRol('administrador') },
    async (req) => {
      await revocarDispositivo(db, req.params.id);
      return { ok: true };
    },
  );
}
