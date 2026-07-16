// Transporte hostil para las pruebas de caos (2.8). Envuelve los handlers
// reales y, según un plan de fallos, simula lo que hace una red de verdad:
// tirar la conexión, perder la respuesta DESPUÉS de que el servidor ya guardó,
// y entregar el mismo lote dos veces.
import { procesarPull } from './pull';
import { procesarPush } from './push';
import { ErrorRed } from '@lena/cliente';
import type { Transporte } from '@lena/cliente';
import type { PeticionPull, PeticionPush } from '@lena/shared';
import type { Db } from '../db';

export type Falla =
  | 'ok'
  | 'cae' // no llega al servidor: nada se guarda
  | 'respuesta_perdida' // el servidor guarda, pero el cliente no se entera (reintenta)
  | 'duplica'; // el lote llega dos veces (el servidor debe deduplicar)

export class TransporteCaotico implements Transporte {
  private i = 0;
  // Cuando se agota el plan, la red se vuelve confiable: así el test puede
  // llegar a un estado estable y verificar convergencia.
  constructor(
    private readonly db: Db,
    private readonly plan: readonly Falla[] = [],
  ) {}

  private siguiente(): Falla {
    return this.plan[this.i++] ?? 'ok';
  }

  async push(p: PeticionPush) {
    const falla = this.siguiente();
    if (falla === 'cae') throw new ErrorRed();
    const r = await procesarPush(this.db, p);
    if (falla === 'duplica') await procesarPush(this.db, p); // idempotente
    if (falla === 'respuesta_perdida') throw new ErrorRed();
    return r;
  }

  async pull(p: PeticionPull) {
    const falla = this.siguiente();
    if (falla === 'cae' || falla === 'respuesta_perdida') throw new ErrorRed();
    return procesarPull(this.db, p);
  }
}
