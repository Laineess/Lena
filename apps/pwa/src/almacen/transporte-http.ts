// Transporte real hacia el API (fetch). Implementa la interfaz Transporte de
// @lena/cliente. Un fallo de red se traduce a ErrorRed para que el motor lo
// reintente en vez de perder el evento.
import { ErrorRed } from '@lena/cliente';
import type { Transporte } from '@lena/cliente';
import type { PeticionPull, PeticionPush, RespuestaPull, RespuestaPush } from '@lena/shared';

export class TransporteHttp implements Transporte {
  constructor(
    private readonly base: string,
    private readonly token: () => string | null,
  ) {}

  private async pedir<T>(ruta: string, init: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${ruta}`, {
        ...init,
        headers: {
          'content-type': 'application/json',
          ...(this.token() ? { authorization: `Bearer ${this.token()}` } : {}),
          ...init.headers,
        },
      });
    } catch {
      throw new ErrorRed(); // caída de red: se reintenta
    }
    if (res.status === 401) throw new ErrorRed('sesión vencida');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<T>;
  }

  push(peticion: PeticionPush): Promise<RespuestaPush> {
    return this.pedir('/sync/push', { method: 'POST', body: JSON.stringify(peticion) });
  }

  pull(peticion: PeticionPull): Promise<RespuestaPull> {
    const q = new URLSearchParams({
      sucursalId: peticion.sucursalId,
      desde: String(peticion.desde),
      limite: String(peticion.limite),
    });
    return this.pedir(`/sync/pull?${q}`, { method: 'GET' });
  }
}
