// Cliente de los endpoints del API (auth + catálogo). URLs relativas: el proxy
// de Vite (dev) o Caddy (prod) las mandan al servidor.
import type { Rol } from '@lena/shared';

export interface Usuario {
  id: string;
  nombre: string;
  rol: Rol;
}

export interface ProductoCat {
  id: string;
  categoriaId: string;
  nombre: string;
  precio: number; // centavos
  disponible: boolean;
}

export interface Mesa {
  id: string;
  nombre: string;
}

export interface Catalogo {
  categorias: { id: string; nombre: string; orden: number }[];
  productos: ProductoCat[];
  mesas: Mesa[];
}

export interface DatosSesion {
  acceso: string;
  refresh: string;
  sesion: { usuarioId: string; rol: Rol; sucursalId: string | null; dispositivoId: string | null };
}

async function postJson<T>(ruta: string, cuerpo: unknown, token?: string): Promise<T> {
  const res = await fetch(ruta, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(cuerpo),
  });
  if (!res.ok) throw new ErrorApi(res.status, (await res.json().catch(() => ({}))) as Record<string, unknown>);
  return res.json() as Promise<T>;
}

export class ErrorApi extends Error {
  constructor(
    readonly status: number,
    readonly cuerpo: Record<string, unknown>,
  ) {
    super(`API ${status}: ${String(cuerpo.error ?? '')}`);
  }
}

export function usuariosDeDispositivo(dispositivoId: string, tokenDispositivo: string) {
  return postJson<{ sucursalId: string; usuarios: Usuario[] }>('/auth/dispositivo/usuarios', {
    dispositivoId,
    tokenDispositivo,
  });
}

export function loginPin(datos: { dispositivoId: string; tokenDispositivo: string; usuarioId: string; pin: string }) {
  return postJson<DatosSesion>('/auth/login/pin', datos);
}

export function refrescar(refresh: string) {
  return postJson<DatosSesion>('/auth/refresh', { refresh });
}

export async function obtenerCatalogo(token: string): Promise<Catalogo> {
  const res = await fetch('/catalogo', { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new ErrorApi(res.status, {});
  return res.json() as Promise<Catalogo>;
}
