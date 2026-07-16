// Motor de sincronización del cliente (05 §4.5, ADR-005).
//
// Offline-first: encolar SIEMPRE funciona sin red. drenar() y jalar() mueven
// datos cuando hay conexión. Si la red falla, se para y se reintenta luego —
// nunca se pierde un evento (RNF-D-3).
import { LOTE_MAXIMO, PAGINA_MAXIMA, plegarComanda } from '@lena/shared';
import type { Comanda, EventoCable } from '@lena/shared';
import type { Almacen } from './almacen';
import { ErrorRed } from './transporte';
import type { Transporte } from './transporte';

export interface OpcionesMotor {
  sucursalId: string;
  dispositivoId: string;
}

export class MotorSync {
  constructor(
    private readonly almacen: Almacen,
    private readonly transporte: Transporte,
    private readonly opts: OpcionesMotor,
  ) {}

  // Genera un evento local. No toca la red: entra a la cola y ya.
  async crear(e: EventoCable): Promise<void> {
    await this.almacen.encolar(e);
  }

  // Vacía la cola contra el servidor, en lotes. Un rechazo de negocio saca el
  // evento de la cola y lo registra como conflicto (RF-J-7); un ErrorRed corta
  // y deja todo para el próximo intento.
  async drenar(): Promise<void> {
    for (;;) {
      const pendientes = await this.almacen.pendientes();
      if (pendientes.length === 0) return;
      const lote = pendientes.slice(0, LOTE_MAXIMO);

      const r = await this.transporte.push({ dispositivoId: this.opts.dispositivoId, eventos: lote });

      await this.almacen.sacarDeCola(r.aceptados);
      for (const rc of r.rechazados) await this.almacen.registrarConflicto(rc);
      await this.almacen.sacarDeCola(r.rechazados.map((x) => x.id));
      for (const f of r.folios) await this.almacen.guardarFolio(f.comandaId, f.folio);

      // Si el lote no movió la aguja, corta para no girar en seco.
      const resueltos = r.aceptados.length + r.rechazados.length;
      if (resueltos === 0) return;
    }
  }

  // Trae lo nuevo del servidor desde el cursor, paginando.
  async jalar(): Promise<void> {
    for (;;) {
      const desde = await this.almacen.cursor();
      const r = await this.transporte.pull({ sucursalId: this.opts.sucursalId, desde, limite: PAGINA_MAXIMA });
      await this.almacen.registrarRemotos(r.eventos);
      await this.almacen.fijarCursor(r.seq);
      if (!r.hayMas) return;
    }
  }

  // Un ciclo completo. Envuelve la red: si se cae, no revienta al llamador.
  async sincronizar(): Promise<{ ok: boolean }> {
    try {
      await this.drenar();
      await this.jalar();
      return { ok: true };
    } catch (e) {
      if (e instanceof ErrorRed) return { ok: false };
      throw e;
    }
  }

  // Lectura offline: pliega el log local. Misma función que el servidor.
  async comanda(comandaId: string): Promise<Comanda | null> {
    return plegarComanda(comandaId, await this.almacen.log());
  }

  async pendientes(): Promise<number> {
    return (await this.almacen.pendientes()).length;
  }
}
