/**
 * Hybrid Logical Clock (ADR-003).
 *
 * EL PROBLEMA QUE RESUELVE
 * Las tablets tienen el reloj mal puesto. Siempre. Un `timestamp` de cliente
 * puede venir del futuro o del pasado, y si ordenamos eventos por él, una
 * comanda puede aparecer "entregada" antes que "lista".
 *
 * Un reloj lógico puro (Lamport) arregla el orden causal pero pierde toda
 * relación con el tiempo real: no sabrías si una comanda lleva 2 o 40 minutos.
 * Un HLC combina ambos: ordena causalmente Y se mantiene cerca del reloj de
 * pared.
 *
 * CÓMO
 *   fisico  — el mayor entre el reloj local y el de los mensajes recibidos
 *   logico  — desempata cuando el físico no avanza
 *   nodo    — desempata cuando físico y lógico empatan (dos dispositivos)
 *
 * La invariante que lo hace funcionar: al RECIBIR un HLC remoto, el reloj
 * local salta hacia adelante si el remoto va más adelantado. Así el orden
 * causal se propaga entre dispositivos aunque sus relojes mientan.
 *
 * FORMATO
 *   "000001926f4a1c80-0003-A1B2"
 *    │                │    └── nodo (id de dispositivo, corto)
 *    │                └─────── contador lógico, hex, 4 dígitos
 *    └──────────────────────── milisegundos, hex, 16 dígitos
 *
 * Se ordena LEXICOGRÁFICAMENTE. Eso es a propósito: Postgres puede indexarlo
 * y ordenarlo como texto, sin funciones ni parseo.
 */

/** Un HLC serializado. Ordenable con comparación de strings. */
export type Hlc = string;

export interface HlcPartes {
  fisico: number;
  logico: number;
  nodo: string;
}

/** El contador lógico cabe en 4 dígitos hex. */
const LOGICO_MAX = 0xffff;

/**
 * Cuánto se tolera que un reloj remoto venga del futuro.
 *
 * Si una tablet tiene el reloj adelantado 3 días y aceptamos su HLC sin
 * límite, TODOS los eventos futuros de esa sucursal quedan anclados a ese
 * tiempo hasta que el reloj de pared lo alcance — 3 días de cronómetros
 * absurdos en cocina.
 *
 * Con el límite, ese evento se rechaza y se registra como conflicto
 * (RF-J-7) en vez de envenenar el reloj de todos.
 */
export const DERIVA_MAXIMA_MS = 60_000;

export class ErrorDerivaReloj extends Error {
  constructor(
    readonly derivaMs: number,
    readonly hlcRemoto: Hlc,
  ) {
    super(
      `El HLC remoto viene ${Math.round(derivaMs / 1000)}s del futuro ` +
        `(máximo tolerado: ${DERIVA_MAXIMA_MS / 1000}s). HLC: ${hlcRemoto}`,
    );
    this.name = 'ErrorDerivaReloj';
  }
}

export function formatearHlc({ fisico, logico, nodo }: HlcPartes): Hlc {
  return `${fisico.toString(16).padStart(16, '0')}-${logico
    .toString(16)
    .padStart(4, '0')}-${nodo}`;
}

export function parsearHlc(hlc: Hlc): HlcPartes {
  const partes = hlc.split('-');
  if (partes.length !== 3) {
    throw new Error(`HLC mal formado: ${hlc}`);
  }
  const [fisicoHex, logicoHex, nodo] = partes as [string, string, string];
  const fisico = Number.parseInt(fisicoHex, 16);
  const logico = Number.parseInt(logicoHex, 16);
  if (Number.isNaN(fisico) || Number.isNaN(logico) || nodo.length === 0) {
    throw new Error(`HLC mal formado: ${hlc}`);
  }
  return { fisico, logico, nodo };
}

/**
 * Orden total y determinista entre dos HLC.
 *
 * Devuelve <0 si a va antes, >0 si a va después, 0 si son el mismo.
 *
 * El desempate por `nodo` es lo que lo hace un orden TOTAL: sin él, dos
 * dispositivos podrían generar HLC "iguales" y el plegado de eventos daría
 * resultados distintos según el orden de llegada — rompiendo RNF-I-6
 * (cliente y servidor deben converger al mismo estado).
 */
export function compararHlc(a: Hlc, b: Hlc): number {
  if (a === b) return 0;
  const pa = parsearHlc(a);
  const pb = parsearHlc(b);
  if (pa.fisico !== pb.fisico) return pa.fisico - pb.fisico;
  if (pa.logico !== pb.logico) return pa.logico - pb.logico;
  return pa.nodo < pb.nodo ? -1 : pa.nodo > pb.nodo ? 1 : 0;
}

export function hlcMayor(a: Hlc, b: Hlc): Hlc {
  return compararHlc(a, b) >= 0 ? a : b;
}

/**
 * Reloj HLC de un dispositivo.
 *
 * `ahora()` — al generar un evento propio.
 * `recibir()` — al aplicar un evento ajeno. NO es un setter: avanza el reloj
 * local si el remoto va adelante, y así propaga el orden causal.
 */
export class RelojHlc {
  private fisico = 0;
  private logico = 0;

  constructor(
    private readonly nodo: string,
    private readonly ahoraMs: () => number = Date.now,
  ) {
    if (nodo.length === 0 || nodo.includes('-')) {
      // El '-' es el separador del formato: un nodo con guiones rompería
      // parsearHlc() de una forma silenciosa y muy difícil de rastrear.
      throw new Error(`Nodo inválido: "${nodo}". No puede estar vacío ni contener '-'.`);
    }
  }

  /** Genera el HLC del siguiente evento local. */
  ahora(): Hlc {
    const pared = this.ahoraMs();

    if (pared > this.fisico) {
      // El reloj de pared avanzó: nos alineamos y reiniciamos el contador.
      this.fisico = pared;
      this.logico = 0;
    } else {
      // El reloj de pared NO avanzó (dos eventos en el mismo milisegundo, o
      // el reloj se fue hacia atrás por NTP). El contador lógico mantiene el
      // orden sin depender del reloj físico.
      this.logico += 1;
      if (this.logico > LOGICO_MAX) {
        // Más de 65536 eventos en un milisegundo. Imposible en esta app;
        // si pasa, es un bug (un bucle generando HLC) y hay que verlo.
        throw new Error('Desbordamiento del contador lógico del HLC');
      }
    }

    return formatearHlc({ fisico: this.fisico, logico: this.logico, nodo: this.nodo });
  }

  /**
   * Aplica un HLC remoto y devuelve el HLC del evento que lo recibe.
   *
   * Esta es la operación que propaga el orden causal entre dispositivos:
   * si el remoto va adelante, el reloj local salta hacia allá.
   *
   * @throws {ErrorDerivaReloj} si el remoto viene demasiado del futuro.
   */
  recibir(hlcRemoto: Hlc): Hlc {
    const remoto = parsearHlc(hlcRemoto);
    const pared = this.ahoraMs();

    const deriva = remoto.fisico - pared;
    if (deriva > DERIVA_MAXIMA_MS) {
      throw new ErrorDerivaReloj(deriva, hlcRemoto);
    }

    const maxFisico = Math.max(pared, this.fisico, remoto.fisico);

    if (maxFisico === this.fisico && maxFisico === remoto.fisico) {
      // Empate entre local y remoto: el contador lógico desempata.
      this.logico = Math.max(this.logico, remoto.logico) + 1;
    } else if (maxFisico === this.fisico) {
      this.logico += 1;
    } else if (maxFisico === remoto.fisico) {
      this.logico = remoto.logico + 1;
    } else {
      // El reloj de pared superó a ambos: empezamos limpio.
      this.logico = 0;
    }

    this.fisico = maxFisico;

    if (this.logico > LOGICO_MAX) {
      throw new Error('Desbordamiento del contador lógico del HLC');
    }

    return formatearHlc({ fisico: this.fisico, logico: this.logico, nodo: this.nodo });
  }

  /** Estado interno. Para diagnóstico y pruebas. */
  estado(): HlcPartes {
    return { fisico: this.fisico, logico: this.logico, nodo: this.nodo };
  }
}
