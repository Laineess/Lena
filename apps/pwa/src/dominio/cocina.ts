// Lógica de la vista de cocina (09 §6). Pura: se prueba sin React.
import { parsearHlc, plegarComanda } from '@lena/shared';
import type { Comanda, Evento, Linea } from '@lena/shared';

// Estados en los que una comanda le importa a cocina: tiene algo por preparar.
const EN_COCINA = new Set(['enviada', 'en_preparacion']);

export function comandasEnCocina(log: readonly Evento[]): Comanda[] {
  const ids = new Set(log.map((e) => e.comandaId));
  const cocina: Comanda[] = [];
  for (const id of ids) {
    const c = plegarComanda(id, log);
    if (c && EN_COCINA.has(c.estado)) cocina.push(c);
  }
  // La más vieja primero (va a la izquierda, 09 §6): se ordena por su espera.
  return cocina.sort((a, b) => (inicioEspera(a) ?? 0) - (inicioEspera(b) ?? 0));
}

// Milisegundo (del HLC) de la línea pendiente MÁS VIEJA. Es el reloj de la
// tarjeta. En una comanda que regresa, las líneas viejas ya están 'lista', así
// que el reloj arranca en las nuevas: se reinicia solo (09 §6.3).
export function inicioEspera(c: Comanda): number | null {
  let min: number | null = null;
  for (const l of c.lineas) {
    if ((l.estado === 'pendiente' || l.estado === 'en_preparacion') && l.enviadaHlc) {
      const t = parsearHlc(l.enviadaHlc).fisico;
      if (min === null || t < min) min = t;
    }
  }
  return min;
}

// Las líneas por preparar (destacadas) y las ya servidas (tachadas), 09 §6.3.
export function lineasPendientes(c: Comanda): Linea[] {
  return c.lineas.filter((l) => l.estado === 'pendiente' || l.estado === 'en_preparacion');
}
export function lineasServidas(c: Comanda): Linea[] {
  return c.lineas.filter((l) => l.estado === 'lista');
}

// ── Color por tiempo (RF-F-7, RF-F-8) ────────────────────────

export type Tier = 'gris' | 'amarillo' | 'naranja' | 'rojo';

// Umbrales en minutos (configurables por sucursal, RF-F-8; aquí el default).
export function tierPorMinutos(min: number): Tier {
  if (min >= 8) return 'rojo';
  if (min >= 5) return 'naranja';
  if (min >= 2) return 'amarillo';
  return 'gris';
}

export const COLOR_TIER: Record<Tier, { relleno: string; borde: string; chip: string; pulsa: boolean }> = {
  gris: { relleno: '#292524', borde: '#57534e', chip: '⚪', pulsa: false },
  amarillo: { relleno: '#854D0E', borde: '#FACC15', chip: '🟡', pulsa: false },
  naranja: { relleno: '#9A3412', borde: '#FB923C', chip: '🟠', pulsa: false },
  rojo: { relleno: '#991B1B', borde: '#F87171', chip: '🔴', pulsa: true },
};

export function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// HLC máximo del log (o de una comanda). El reloj del emisor se avanza más allá
// de este antes de emitir, para que su evento sea causalmente posterior.
export function hlcMaximo(log: readonly Evento[], comandaId?: string): string | null {
  let max: string | null = null;
  for (const e of log) {
    if (comandaId && e.comandaId !== comandaId) continue;
    if (max === null || e.hlc > max) max = e.hlc;
  }
  return max;
}

// ── Cancelaciones para la alerta de cocina (RF-F-11) ─────────

// Comandas canceladas con el momento (ms) de su cancelación, para mostrarlas
// como alerta hasta que el cocinero las reconozca.
export function comandasCanceladas(log: readonly Evento[]): { comanda: Comanda; canceladaEn: number; motivo: string }[] {
  const ids = new Set(log.map((e) => e.comandaId));
  const out: { comanda: Comanda; canceladaEn: number; motivo: string }[] = [];
  for (const id of ids) {
    const c = plegarComanda(id, log);
    if (!c || c.estado !== 'cancelada') continue;
    // Momento de la cancelación: el HLC mayor entre los eventos de cancelación.
    const cancel = log
      .filter((e) => e.comandaId === id && (e.tipo === 'comanda_cancelada' || e.tipo === 'linea_cancelada'))
      .reduce<number | null>((max, e) => {
        const t = parsearHlc(e.hlc).fisico;
        return max === null || t > max ? t : max;
      }, null);
    if (cancel !== null) out.push({ comanda: c, canceladaEn: cancel, motivo: c.motivoCancelacion ?? '' });
  }
  return out;
}
