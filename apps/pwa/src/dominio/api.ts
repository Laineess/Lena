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

export interface Umbrales {
  amarillo: number;
  naranja: number;
  rojo: number;
}

export interface Catalogo {
  categorias: { id: string; nombre: string; orden: number }[];
  productos: ProductoCat[];
  mesas: Mesa[];
  umbrales: Umbrales;
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

export function loginAdmin(datos: { email: string; password: string }) {
  return postJson<DatosSesion>('/auth/login/admin', datos);
}

export function refrescar(refresh: string) {
  return postJson<DatosSesion>('/auth/refresh', { refresh });
}

export async function obtenerCatalogo(token: string): Promise<Catalogo> {
  const res = await fetch('/catalogo', { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new ErrorApi(res.status, {});
  return res.json() as Promise<Catalogo>;
}

export interface ComandaHistorial {
  id: string;
  folio: number | null;
  tipoServicio: string;
  estado: string;
  total: number; // centavos
  cerradaAt: string | null;
}

export async function obtenerHistorial(token: string): Promise<ComandaHistorial[]> {
  const res = await fetch('/comandas', { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new ErrorApi(res.status, {});
  return res.json() as Promise<ComandaHistorial[]>;
}

// RF-F-10: cocina marca un producto no disponible ("se acabó").
export async function marcarDisponibilidad(token: string, productoId: string, disponible: boolean): Promise<void> {
  const res = await fetch(`/productos/${productoId}/disponibilidad`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ disponible }),
  });
  if (!res.ok) throw new ErrorApi(res.status, {});
}

// ── Turno de caja (RF-H) ─────────────────────────────────────

export interface TurnoActual {
  id: string;
  fondoInicial: number;
  abiertoAt: string;
}

export async function turnoActual(token: string): Promise<TurnoActual | null> {
  const res = await fetch('/turno/actual', { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new ErrorApi(res.status, {});
  return res.json() as Promise<TurnoActual | null>;
}

export function abrirTurno(token: string, fondoInicial: number): Promise<{ id: string }> {
  return postJson('/turno/abrir', { fondoInicial }, token);
}

export interface CierreTurno {
  esperado: number;
  contado: number;
  diferencia: number;
  desglose: { efectivo: number; tarjeta: number; transferencia: number };
}

// ── Administrador (RF-I, RF-H-9) ─────────────────────────────

async function authGet<T>(ruta: string, token: string): Promise<T> {
  const res = await fetch(ruta, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new ErrorApi(res.status, {});
  return res.json() as Promise<T>;
}

export interface Resumen {
  ventas: number;
  comandas: number;
  ticket: number;
  merma: number;
}
export interface MermaMesero {
  id: string;
  nombre: string;
  comandas: number;
  canceladas: number;
  tasa: number;
  merma: number;
  vsEquipo: number;
}
export interface ReporteMerma {
  total: number;
  meseros: MermaMesero[];
  productos: { nombre: string; cantidad: number; costo: number }[];
}
export interface Cancelada {
  id: string;
  folio: number | null;
  mesero: string;
  momento: string;
  motivo: string | null;
  costoMermado: number;
}
export interface Corte {
  id: string;
  fondoInicial: number;
  esperado: number;
  contado: number;
  diferencia: number;
  tarjeta: number;
  transferencia: number;
  cerradoAt: string | null;
}
export interface MasVendido {
  nombre: string;
  unidades: number;
  importe: number;
}

const q = (desde?: string, hasta?: string) => (desde ? `?desde=${desde}&hasta=${hasta ?? desde}` : '');

// Descarga un CSV autenticado (el endpoint exige token, un <a href> no basta).
export async function exportarCsv(token: string, reporte: string, desde: string, hasta: string): Promise<void> {
  const res = await fetch(`/admin/export/${reporte}?desde=${desde}&hasta=${hasta}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new ErrorApi(res.status, {});
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${reporte}-${desde}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export interface UsuarioAdmin {
  id: string;
  nombre: string;
  rol: string;
  sucursalId: string | null;
  activo: boolean;
}
export interface Gasto {
  id: string;
  categoria: string;
  concepto: string;
  monto: number;
  fecha: string;
}
export interface CambioPrecio {
  precioAnterior: string;
  precioNuevo: string;
  createdAt: string;
}

async function authSend<T>(metodo: string, ruta: string, token: string, cuerpo?: unknown): Promise<T> {
  const res = await fetch(ruta, {
    method: metodo,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
  });
  if (!res.ok) throw new ErrorApi(res.status, (await res.json().catch(() => ({}))) as Record<string, unknown>);
  return res.json() as Promise<T>;
}

export const admin = {
  resumen: (t: string, d?: string, h?: string) => authGet<Resumen>(`/admin/resumen${q(d, h)}`, t),
  merma: (t: string, d?: string, h?: string) => authGet<ReporteMerma>(`/admin/merma${q(d, h)}`, t),
  canceladas: (t: string, d?: string, h?: string) => authGet<Cancelada[]>(`/admin/canceladas${q(d, h)}`, t),
  masVendidos: (t: string, d?: string, h?: string) => authGet<MasVendido[]>(`/admin/mas-vendidos${q(d, h)}`, t),
  ventasPorHora: (t: string, d?: string, h?: string) =>
    authGet<{ hora: number; ventas: number; comandas: number }[]>(`/admin/ventas-por-hora${q(d, h)}`, t),
  cortes: (t: string, d?: string, h?: string) => authGet<Corte[]>(`/admin/cortes${q(d, h)}`, t),
  // Gestión (RF-C/D/I-4)
  usuarios: (t: string) => authGet<UsuarioAdmin[]>('/admin/usuarios', t),
  crearUsuario: (t: string, u: { nombre: string; rol: string; sucursalId: string; pin: string }) =>
    authSend<{ id: string }>('POST', '/admin/usuarios', t, u),
  bajaUsuario: (t: string, id: string) =>
    authSend<{ ok: boolean }>('PATCH', `/admin/usuarios/${id}`, t, { activo: false }),
  cambiarPin: (t: string, id: string, pin: string) =>
    authSend<{ ok: boolean }>('PATCH', `/admin/usuarios/${id}/pin`, t, { pin }),
  cambiarPrecio: (t: string, id: string, precio: number) =>
    authSend<{ ok: boolean }>('PATCH', `/admin/productos/${id}/precio`, t, { precio }),
  historialPrecios: (t: string, id: string) => authGet<CambioPrecio[]>(`/admin/productos/${id}/precios`, t),
  gastos: (t: string, d?: string, h?: string) => authGet<Gasto[]>(`/admin/gastos${q(d, h)}`, t),
  crearGasto: (
    t: string,
    g: { sucursalId: string; categoria: string; concepto: string; monto: number; fecha: string },
  ) => authSend<{ id: string }>('POST', '/admin/gastos', t, g),
  sucursales: (t: string) => authGet<{ id: string; nombre: string }[]>('/admin/sucursales', t),
};

// Devuelve el cierre, o {comandasAbiertas} si el servidor bloqueó (RF-H-8).
export async function cerrarTurno(
  token: string,
  contadoEfectivo: number,
  motivo?: string,
): Promise<{ ok: true; cierre: CierreTurno } | { ok: false; error: string; comandas?: unknown[] | undefined }> {
  const res = await fetch('/turno/cerrar', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ contadoEfectivo, ...(motivo ? { motivo } : {}) }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.ok) return { ok: true, cierre: body as unknown as CierreTurno };
  return { ok: false, error: String(body.error ?? 'error'), comandas: body.comandas as unknown[] | undefined };
}
