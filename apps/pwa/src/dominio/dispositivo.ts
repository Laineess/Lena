// La única config local del "lugar" es la LETRA para el voceo (A-1, B-3…,
// 09 §4.2), que también hace de nodo del reloj HLC. La autenticación ahora va
// por clave de sucursal (el servidor asigna el dispositivo), así que ya no se
// guardan id ni token en el cliente.
export interface ConfigDispositivo {
  letra: string;
}

const CLAVE = 'lena.letra';

export function configDispositivo(): ConfigDispositivo {
  return { letra: localStorage.getItem(CLAVE) ?? 'A' };
}

export function guardarLetra(letra: string): void {
  localStorage.setItem(CLAVE, letra);
}

// Consecutivo local para el identificador que se vocea. Nunca cambia al
// sincronizar (09 §4.2): es un contador del dispositivo, no el folio.
function siguienteConsecutivo(): number {
  const n = Number(localStorage.getItem('lena.consecutivo') ?? '0') + 1;
  localStorage.setItem('lena.consecutivo', String(n));
  return n;
}

// Asigna y persiste el identificador para vocear de una comanda (A-7). Se
// guarda por comandaId para poder mostrarlo también en la lista de abiertas.
export function asignarVoceo(comandaId: string, letra: string): string {
  const v = `${letra}-${siguienteConsecutivo()}`;
  localStorage.setItem(`lena.voceo.${comandaId}`, v);
  return v;
}

export function leerVoceo(comandaId: string): string | null {
  return localStorage.getItem(`lena.voceo.${comandaId}`);
}
