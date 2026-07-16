// Configuración del dispositivo. En producción la deja el registro (RS-A-9);
// en desarrollo hay un valor por defecto que coincide con el seed (Tablet A).
export interface ConfigDispositivo {
  dispositivoId: string;
  tokenDispositivo: string;
  letra: string; // para el identificador que se vocea: A-1, A-2… (09 §4.2)
}

const CLAVE = 'lena.dispositivo';

const DEV: ConfigDispositivo = {
  dispositivoId: '01930000-0000-7000-8000-000000000020',
  tokenDispositivo: 'token-de-prueba-tableta-a',
  letra: 'A',
};

export function configDispositivo(): ConfigDispositivo {
  const raw = localStorage.getItem(CLAVE);
  if (raw) return JSON.parse(raw) as ConfigDispositivo;
  return DEV;
}

export function guardarConfigDispositivo(c: ConfigDispositivo): void {
  localStorage.setItem(CLAVE, JSON.stringify(c));
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
