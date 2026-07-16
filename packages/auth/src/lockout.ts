// Bloqueo por intentos fallidos (RS-A-4): 5 min tras 5 fallos en el mismo
// dispositivo, con backoff exponencial en reincidencias. Puro: recibe la lista
// de fallos recientes y decide. El servicio le pasa lo que hay en la base.
export const MAX_FALLOS = 5;
export const BLOQUEO_BASE_MS = 5 * 60_000;

// Backoff: 5 min, 10, 20, 40… topado. Cada tanda de 5 fallos sube el escalón.
export function bloqueadoHasta(fallosDesdeUltimoExito: readonly Date[], ahora: number = Date.now()): number | null {
  if (fallosDesdeUltimoExito.length < MAX_FALLOS) return null;

  const tandas = Math.floor(fallosDesdeUltimoExito.length / MAX_FALLOS);
  const espera = Math.min(BLOQUEO_BASE_MS * 2 ** (tandas - 1), 60 * 60_000);

  // Ordenados asc: el último fallo marca el arranque del bloqueo.
  const ultimo = fallosDesdeUltimoExito[fallosDesdeUltimoExito.length - 1];
  if (!ultimo) return null;
  const fin = ultimo.getTime() + espera;
  return fin > ahora ? fin : null;
}

export function estaBloqueado(fallos: readonly Date[], ahora: number = Date.now()): boolean {
  return bloqueadoHasta(fallos, ahora) !== null;
}
