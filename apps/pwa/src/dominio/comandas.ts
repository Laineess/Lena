// Comandas abiertas a partir del log LOCAL (offline). El histórico (cerradas)
// se pide al servidor, no se guarda en el dispositivo (RS-L-4).
import { plegarComanda } from '@lena/shared';
import type { Comanda, Evento } from '@lena/shared';

const TERMINAL = new Set(['cobrada', 'cancelada']);

// Pliega cada comanda del log y deja solo las abiertas con al menos una línea.
export function comandasAbiertas(log: readonly Evento[]): Comanda[] {
  const ids = new Set(log.map((e) => e.comandaId));
  const abiertas: Comanda[] = [];
  for (const id of ids) {
    const c = plegarComanda(id, log);
    if (c && !TERMINAL.has(c.estado) && c.lineas.some((l) => l.estado !== 'cancelada')) {
      abiertas.push(c);
    }
  }
  return abiertas;
}
