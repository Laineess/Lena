// Cliente de los endpoints del API (auth + catálogo). URLs relativas: el proxy
// de Vite (dev) o Caddy (prod) las mandan al servidor.
import type { Rol } from '@lena/shared';

// Rol de la sesión: el del log (eventos) más `superadmin`, que es de gestión,
// no de comandas. Ver 07 §roles.
export type RolSesion = Rol | 'superadmin';

// El rol para un evento del log. El superadmin nunca captura/cobra (va al
// escritorio), pero el tipo lo contempla: si llegara, cuenta como administrador.
export function rolEvento(r: RolSesion): Rol {
  return r === 'superadmin' ? 'administrador' : r;
}

export interface Usuario {
  id: string;
  nombre: string;
  rol: Rol;
}

export interface ProductoCat {
  id: string;
  categoriaId: string;
  subcategoria: string | null;
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
  sesion: { usuarioId: string; rol: RolSesion; sucursalId: string | null; dispositivoId: string | null };
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

// Paso 1 del ingreso: la clave de la sucursal resuelve a sus usuarios de PIN.
export function sucursalPorClave(clave: string) {
  return postJson<{ sucursalId: string; nombre: string; letra: string; usuarios: Usuario[] }>('/auth/sucursal', {
    clave,
  });
}

// Paso 2: usuario + PIN dentro de esa sucursal. Devuelve la sesión y la letra
// de voceo (A-1/B-3) del dispositivo de la sucursal.
export function loginPin(datos: { claveSucursal: string; usuarioId: string; pin: string }) {
  return postJson<DatosSesion & { letra?: string }>('/auth/login/pin', datos);
}

export function loginAdmin(datos: { email: string; password: string }) {
  return postJson<DatosSesion>('/auth/login/admin', datos);
}

export function refrescar(refresh: string) {
  return postJson<DatosSesion>('/auth/refresh', { refresh });
}

// sucursalId solo lo usa el superadmin (panel de productos) para ver la
// disponibilidad de una sucursal concreta; el mesero/cocina no lo manda.
export async function obtenerCatalogo(token: string, sucursalId?: string): Promise<Catalogo> {
  const res = await fetch(`/catalogo${sucursalId ? `?sucursalId=${sucursalId}` : ''}`, {
    headers: { authorization: `Bearer ${token}` },
  });
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
  retiros: number;
  cerradoAt: string | null;
}
export interface MasVendido {
  nombre: string;
  unidades: number;
  importe: number;
}

const q = (desde?: string, hasta?: string, sucursalId?: string) => {
  const p = new URLSearchParams();
  if (desde) {
    p.set('desde', desde);
    p.set('hasta', hasta ?? desde);
  }
  if (sucursalId) p.set('sucursalId', sucursalId);
  const s = p.toString();
  return s ? `?${s}` : '';
};

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

export interface Sucursal {
  id: string;
  nombre: string;
  clave: string;
  direccion: string | null;
  activo: boolean;
  umbralAmarillo: number;
  umbralNaranja: number;
  umbralRojo: number;
}
export interface CajaDia {
  sucursalId: string;
  sucursal: string;
  ventas: number;
  comandas: number;
  comandasAbiertas: number;
  turnoAbierto: boolean;
  abiertoAt: string | null;
  fondoInicial: number | null;
}
export interface ComandaDia {
  id: string;
  folio: number | null;
  tipoServicio: string;
  estado: string;
  total: number;
  mesa: string | null;
  mesero: string | null;
  sucursal: string;
  abiertaAt: string;
  cerradaAt: string | null;
}
export interface ComandaDetalle {
  id: string;
  folio: number | null;
  tipoServicio: string;
  estado: string;
  total: number;
  mesa: string | null;
  mesero: string | null;
  motivoCancelacion: string | null;
  abiertaAt: string;
  cerradaAt: string | null;
  lineas: { nombre: string; cantidad: number; precio: number; estado: string; notas: string | null }[];
  pagos: { metodo: string; monto: number }[];
}

export const admin = {
  resumen: (t: string, d?: string, h?: string, s?: string) => authGet<Resumen>(`/admin/resumen${q(d, h, s)}`, t),
  merma: (t: string, d?: string, h?: string, s?: string) => authGet<ReporteMerma>(`/admin/merma${q(d, h, s)}`, t),
  canceladas: (t: string, d?: string, h?: string, s?: string) =>
    authGet<Cancelada[]>(`/admin/canceladas${q(d, h, s)}`, t),
  masVendidos: (t: string, d?: string, h?: string, s?: string) =>
    authGet<MasVendido[]>(`/admin/mas-vendidos${q(d, h, s)}`, t),
  ventasPorHora: (t: string, d?: string, h?: string, s?: string) =>
    authGet<{ hora: number; ventas: number; comandas: number }[]>(`/admin/ventas-por-hora${q(d, h, s)}`, t),
  cortes: (t: string, d?: string, h?: string, s?: string) => authGet<Corte[]>(`/admin/cortes${q(d, h, s)}`, t),
  caja: (t: string, s?: string) => authGet<CajaDia[]>(`/admin/caja${s ? `?sucursalId=${s}` : ''}`, t),
  comandasDia: (t: string, s?: string) => authGet<ComandaDia[]>(`/admin/comandas-dia${s ? `?sucursalId=${s}` : ''}`, t),
  comandaDetalle: (t: string, id: string) => authGet<ComandaDetalle>(`/admin/comandas/${id}`, t),
  // Gestión (RF-C/D/I-4)
  usuarios: (t: string, s?: string) => authGet<UsuarioAdmin[]>(`/admin/usuarios${s ? `?sucursalId=${s}` : ''}`, t),
  crearUsuario: (t: string, u: { nombre: string; rol: string; sucursalId?: string; pin: string }) =>
    authSend<{ id: string }>('POST', '/admin/usuarios', t, u),
  crearAdmin: (t: string, a: { nombre: string; email: string; password: string; sucursalId: string }) =>
    authSend<{ id: string }>('POST', '/admin/admins', t, a),
  bajaUsuario: (t: string, id: string) =>
    authSend<{ ok: boolean }>('PATCH', `/admin/usuarios/${id}`, t, { activo: false }),
  cambiarPin: (t: string, id: string, pin: string) =>
    authSend<{ ok: boolean }>('PATCH', `/admin/usuarios/${id}/pin`, t, { pin }),
  cambiarPrecio: (t: string, id: string, precio: number) =>
    authSend<{ ok: boolean }>('PATCH', `/admin/productos/${id}/precio`, t, { precio }),
  crearProducto: (t: string, p: { nombre: string; categoria: string; subcategoria?: string; precio: number }) =>
    authSend<{ id: string }>('POST', '/admin/productos', t, p),
  editarProducto: (
    t: string,
    id: string,
    p: { nombre?: string; categoria?: string; subcategoria?: string; activo?: boolean },
  ) => authSend<{ ok: boolean }>('PATCH', `/admin/productos/${id}`, t, p),
  eliminarProducto: (t: string, id: string) =>
    authSend<{ ok: boolean }>('PATCH', `/admin/productos/${id}`, t, { activo: false }),
  cambiarDisponibilidad: (t: string, id: string, disponible: boolean, sucursalId?: string) =>
    authSend<{ id: string; disponible: boolean }>('PATCH', `/productos/${id}/disponibilidad`, t, {
      disponible,
      ...(sucursalId ? { sucursalId } : {}),
    }),
  historialPrecios: (t: string, id: string) => authGet<CambioPrecio[]>(`/admin/productos/${id}/precios`, t),
  // Precio por sucursal (RF-D-8): override del base para una sucursal.
  fijarPrecioSucursal: (t: string, id: string, precio: number, sucursalId?: string) =>
    authSend<{ ok: boolean }>('PUT', `/admin/productos/${id}/precio-sucursal`, t, {
      precio,
      ...(sucursalId ? { sucursalId } : {}),
    }),
  quitarPrecioSucursal: (t: string, id: string, sucursalId?: string) =>
    authSend<{ ok: boolean }>('DELETE', `/admin/productos/${id}/precio-sucursal${sucursalId ? `?sucursalId=${sucursalId}` : ''}`, t),
  renombrarSubcategoria: (t: string, de: string, a: string) =>
    authSend<{ ok: boolean }>('PATCH', '/admin/subcategorias', t, { de, a }),
  editarCategoria: (t: string, id: string, c: { nombre?: string; activo?: boolean }) =>
    authSend<{ ok: boolean }>('PATCH', `/admin/categorias/${id}`, t, c),
  reabrirComanda: (t: string, id: string, motivo: string) =>
    authSend<{ ok: boolean }>('POST', `/admin/comandas/${id}/reabrir`, t, { motivo }),
  ingresosVsGastos: (t: string, d?: string, h?: string, s?: string) =>
    authGet<{ ingresos: number; gastos: number; balance: number }>(`/admin/ingresos-vs-gastos${q(d, h, s)}`, t),
  gastos: (t: string, d?: string, h?: string, s?: string) => authGet<Gasto[]>(`/admin/gastos${q(d, h, s)}`, t),
  crearGasto: (
    t: string,
    g: { sucursalId?: string; categoria: string; concepto: string; monto: number; fecha: string },
  ) => authSend<{ id: string }>('POST', '/admin/gastos', t, g),
  sucursales: (t: string) => authGet<Sucursal[]>('/admin/sucursales', t),
  crearSucursal: (t: string, s: { nombre: string; direccion?: string }) =>
    authSend<{ id: string; clave: string }>('POST', '/admin/sucursales', t, s),
  editarSucursal: (t: string, id: string, s: { nombre?: string; direccion?: string; clave?: string; activo?: boolean }) =>
    authSend<{ ok: boolean }>('PATCH', `/admin/sucursales/${id}`, t, s),
  dispositivos: (t: string) =>
    authGet<{ id: string; nombre: string; activo: boolean; minutosSinSync: number | null }[]>('/admin/dispositivos', t),
};

// ── Fase 2 · parte A — Insumos (RF-L) ──
export type Unidad = 'kg' | 'g' | 'l' | 'ml' | 'pza' | 'caja' | 'manojo';
export interface Insumo {
  id: string;
  nombre: string;
  unidad: Unidad;
  activo: boolean;
}
export interface Proveedor {
  id: string;
  nombre: string;
  contacto: string | null;
  activo: boolean;
}
export interface CompraInsumo {
  id: string;
  insumoId: string;
  insumo: string;
  unidad: string;
  cantidad: number;
  costoTotal: number;
  fecha: string;
}
export interface ConteoInsumo {
  id: string;
  insumoId: string;
  tipo: 'apertura' | 'cierre';
  cantidad: number;
  fecha: string;
}
export interface MermaInsumo {
  id: string;
  insumoId: string;
  insumo: string;
  unidad: string;
  cantidad: number;
  motivo: string;
  fecha: string;
}
export interface ResumenConsumo {
  insumoId: string;
  nombre: string;
  unidad: string;
  consumo: number;
  merma: number;
  dias: number;
}
export interface CompraSugerida {
  insumoId: string;
  nombre: string;
  unidad: string;
  ratio: number | null;
  dias: number;
  stockActual: number;
  stockSeguridad: number;
  diasEntrega: number;
  previstoUnidades: number;
  consumoPrevisto: number;
  recomendado: number | null;
  confianza: 'alta' | 'media' | 'insuficiente';
}

export const insumos = {
  lista: (t: string) => authGet<Insumo[]>('/admin/insumos', t),
  crear: (t: string, i: { nombre: string; unidad: Unidad }) => authSend<{ id: string }>('POST', '/admin/insumos', t, i),
  editar: (t: string, id: string, i: { nombre?: string; unidad?: Unidad; activo?: boolean }) =>
    authSend<{ ok: boolean }>('PATCH', `/admin/insumos/${id}`, t, i),
  proveedores: (t: string) => authGet<Proveedor[]>('/admin/proveedores', t),
  crearProveedor: (t: string, p: { nombre: string; contacto?: string }) =>
    authSend<{ id: string }>('POST', '/admin/proveedores', t, p),
  compras: (t: string, d?: string, h?: string, s?: string) => authGet<CompraInsumo[]>(`/admin/compras${q(d, h, s)}`, t),
  registrarCompra: (
    t: string,
    c: {
      insumoId: string;
      proveedorId?: string;
      cantidad: number;
      costoTotal: number;
      fecha: string;
      pagadoEnEfectivo?: boolean;
      sucursalId?: string;
    },
  ) => authSend<{ id: string }>('POST', '/admin/compras', t, c),
  conteos: (t: string, fecha: string, s?: string) => {
    const p = new URLSearchParams({ fecha });
    if (s) p.set('sucursalId', s);
    return authGet<ConteoInsumo[]>(`/admin/conteos?${p.toString()}`, t);
  },
  guardarConteo: (
    t: string,
    c: { insumoId: string; tipo: 'apertura' | 'cierre'; cantidad: number; fecha: string; sucursalId?: string },
  ) => authSend<{ ok: boolean }>('POST', '/admin/conteos', t, c),
  merma: (t: string, d?: string, h?: string, s?: string) => authGet<MermaInsumo[]>(`/admin/merma-insumo${q(d, h, s)}`, t),
  registrarMerma: (
    t: string,
    m: { insumoId: string; cantidad: number; motivo: string; fecha: string; sucursalId?: string },
  ) => authSend<{ id: string }>('POST', '/admin/merma-insumo', t, m),
  consumo: (t: string, d?: string, h?: string, s?: string) => authGet<ResumenConsumo[]>(`/admin/consumo${q(d, h, s)}`, t),
  // Fase 2 · parte B — compra sugerida (RF-M)
  compraSugerida: (t: string, s?: string) =>
    authGet<CompraSugerida[]>(`/admin/compra-sugerida${s ? `?sucursalId=${s}` : ''}`, t),
  fijarParametro: (t: string, id: string, p: { stockSeguridad: number; diasEntrega: number; sucursalId?: string }) =>
    authSend<{ ok: boolean }>('PUT', `/admin/insumos/${id}/parametro`, t, p),
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
