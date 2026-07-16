// Persistencia local del cliente. La PWA la implementa con Dexie (IndexedDB);
// las pruebas usan la versión en memoria de abajo. El motor de sync no sabe
// cuál es — solo ve esta interfaz.
import { aEventoDominio } from '@lena/shared';
import type { Evento, EventoCable, EventoRechazado } from '@lena/shared';

export interface Almacen {
  // Evento generado en este dispositivo: entra al log local Y a la cola de envío.
  encolar(e: EventoCable): Promise<void>;
  // Lo que falta confirmar el servidor.
  pendientes(): Promise<EventoCable[]>;
  // El servidor los aceptó (o los rechazó definitivamente): salen de la cola.
  sacarDeCola(ids: readonly string[]): Promise<void>;
  // Eventos que llegaron por pull. Se dedup por id.
  registrarRemotos(eventos: readonly EventoCable[]): Promise<void>;
  // Todo el log conocido, para plegar (RNF-M-7).
  log(): Promise<Evento[]>;
  cursor(): Promise<number>;
  fijarCursor(seq: number): Promise<void>;
  registrarConflicto(c: EventoRechazado): Promise<void>;
  conflictos(): Promise<EventoRechazado[]>;
  guardarFolio(comandaId: string, folio: number): Promise<void>;
  folios(): Promise<ReadonlyMap<string, number>>;
}

// Implementación en memoria. Determinista y sin I/O: sirve para el
// property-based testing de convergencia (RNF-I-6).
export class MemoriaAlmacen implements Almacen {
  private readonly eventos = new Map<string, EventoCable>(); // por id, dedup
  private readonly cola = new Set<string>();
  private readonly conflictosLista: EventoRechazado[] = [];
  private readonly foliosMap = new Map<string, number>();
  private cursorSeq = 0;

  async encolar(e: EventoCable): Promise<void> {
    if (!this.eventos.has(e.id)) {
      this.eventos.set(e.id, e);
      this.cola.add(e.id);
    }
  }

  async pendientes(): Promise<EventoCable[]> {
    // En orden de HLC: el servidor recibe causalidad, no orden de inserción.
    return [...this.cola]
      .map((id) => this.eventos.get(id) as EventoCable)
      .sort((a, b) => (a.hlc < b.hlc ? -1 : a.hlc > b.hlc ? 1 : 0));
  }

  async sacarDeCola(ids: readonly string[]): Promise<void> {
    for (const id of ids) this.cola.delete(id);
  }

  async registrarRemotos(eventos: readonly EventoCable[]): Promise<void> {
    for (const e of eventos) {
      // Un evento que vuelve por pull ya no se debe reenviar.
      if (!this.eventos.has(e.id)) this.eventos.set(e.id, e);
      this.cola.delete(e.id);
    }
  }

  async log(): Promise<Evento[]> {
    return [...this.eventos.values()].map(aEventoDominio);
  }

  async cursor(): Promise<number> {
    return this.cursorSeq;
  }

  async fijarCursor(seq: number): Promise<void> {
    // Nunca retrocede: dos pull concurrentes no deben perder terreno.
    if (seq > this.cursorSeq) this.cursorSeq = seq;
  }

  async registrarConflicto(c: EventoRechazado): Promise<void> {
    this.conflictosLista.push(c);
  }

  async conflictos(): Promise<EventoRechazado[]> {
    return [...this.conflictosLista];
  }

  async guardarFolio(comandaId: string, folio: number): Promise<void> {
    this.foliosMap.set(comandaId, folio);
  }

  async folios(): Promise<ReadonlyMap<string, number>> {
    return new Map(this.foliosMap);
  }
}
