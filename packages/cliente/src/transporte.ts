// El canal hacia el servidor. La PWA lo implementa con fetch; las pruebas de
// caos lo implementan con una versión que falla, duplica y reordena a propósito.
import type { PeticionPull, PeticionPush, RespuestaPull, RespuestaPush } from '@lena/shared';

export interface Transporte {
  push(peticion: PeticionPush): Promise<RespuestaPush>;
  pull(peticion: PeticionPull): Promise<RespuestaPull>;
}

// Se lanza cuando la red falla. El motor la distingue de un rechazo de negocio:
// esto se reintenta, un rechazo no.
export class ErrorRed extends Error {
  constructor(mensaje = 'sin conexión') {
    super(mensaje);
    this.name = 'ErrorRed';
  }
}
