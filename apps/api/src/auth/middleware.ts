// Autenticación y autorización en el servidor (RS-Z-1, RS-Z-4, RS-Z-5).
// Denegar por defecto: una ruta sin preHandler de sesión no ve `req.sesion`.
import type { FastifyReply, FastifyRequest } from 'fastify';
import { verificarAcceso } from '@lena/auth';
import type { Sesion } from '@lena/auth';

declare module 'fastify' {
  interface FastifyRequest {
    sesion?: Sesion;
  }
}

function secreto(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('Falta JWT_SECRET');
  return s;
}

function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : null;
}

// preHandler: exige un JWT de acceso válido y deja la sesión en req.sesion.
export async function requiereSesion(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = bearer(req);
  if (!token) return void reply.code(401).send({ error: 'sin_token' });
  try {
    req.sesion = await verificarAcceso(token, secreto());
  } catch {
    return void reply.code(401).send({ error: 'token_invalido' });
  }
}

// preHandler: además del token, exige uno de los roles dados (RS-Z-1).
export function requiereRol(...roles: Sesion['rol'][]) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await requiereSesion(req, reply);
    if (reply.sent) return;
    if (!req.sesion || !roles.includes(req.sesion.rol)) {
      reply.code(403).send({ error: 'rol_no_autorizado' });
    }
  };
}
