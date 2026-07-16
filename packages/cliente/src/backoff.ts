// Espera entre reintentos de sincronización (2.6). Exponencial con tope y
// jitter: el tope evita esperas absurdas, el jitter evita que todas las tablets
// de la sucursal reintenten en el mismo instante y tiren al servidor al volver
// la red (thundering herd).
export const BASE_MS = 1_000;
export const TOPE_MS = 30_000;

export function calcularEspera(intento: number, aleatorio: () => number = Math.random): number {
  const exp = Math.min(TOPE_MS, BASE_MS * 2 ** Math.max(0, intento));
  // Jitter completo: entre 0 y el valor exponencial.
  return Math.floor(exp * aleatorio());
}
