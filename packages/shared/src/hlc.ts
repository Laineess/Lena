export type Hlc = string;

export interface HlcPartes {
  fisico: number;
  logico: number;
  nodo: string;
}

/** El contador lógico cabe en 4 dígitos hex. */
const LOGICO_MAX = 0xffff;

export const NODO_RE = /^[A-Za-z0-9]{1,16}$/;
export const HLC_RE = /^[0-9a-f]{16}-[0-9a-f]{4}-[A-Za-z0-9]{1,16}$/;

export function hlcBienFormado(hlc: string): boolean {
  return HLC_RE.test(hlc);
}

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
  return `${fisico.toString(16).padStart(16, '0')}-${logico.toString(16).padStart(4, '0')}-${nodo}`;
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
    if (!NODO_RE.test(nodo)) {
      // Mismo regex que el cable (protocolo.ts): si divergen, el dispositivo
      // genera HLC que el servidor rechaza y el mesero solo ve "no sincroniza".
      throw new Error(`Nodo inválido: "${nodo}". Alfanumérico, 1 a 16 caracteres.`);
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
