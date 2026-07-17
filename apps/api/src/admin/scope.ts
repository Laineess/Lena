// Alcance de sucursal para gestión y reportes.
// - administrador: SIEMPRE su sucursal (ignora cualquier sucursalId del cliente,
//   RS-Z-2). No puede ver ni tocar otra.
// - superadmin: la que pida (?sucursalId) o todas (undefined) si no filtra.
import type { FastifyRequest } from 'fastify';

export function sucursalScope(req: FastifyRequest, pedida?: string): string | undefined {
  if (req.sesion?.rol === 'administrador') return req.sesion.sucursalId ?? undefined;
  return pedida;
}

export function esSuperadmin(req: FastifyRequest): boolean {
  return req.sesion?.rol === 'superadmin';
}
