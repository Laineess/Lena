// Almacén del cliente sobre IndexedDB (Dexie) — la impl de producción de la
// interfaz Almacen de @lena/cliente. En fase 2 solo existía la versión en
// memoria; esta es la que persiste en la tablet y sobrevive a un cierre de app.
//
// RS-L-1/L-2: guarda solo lo del turno abierto y su outbox; el histórico se
// consulta contra el servidor. La purga al cerrar turno vive en el flujo de caja.
import Dexie from 'dexie';
import type { EntityTable } from 'dexie';
import { aEventoDominio } from '@lena/shared';
import type { Almacen } from '@lena/cliente';
import type { Evento, EventoCable, EventoRechazado } from '@lena/shared';

// enCola es 0/1 y no boolean: IndexedDB no indexa booleanos.
type EventoFila = EventoCable & { enCola: 0 | 1 };

class BaseLena extends Dexie {
  eventos!: EntityTable<EventoFila, 'id'>;
  conflictos!: EntityTable<EventoRechazado & { n: number }, 'n'>;
  folios!: EntityTable<{ comandaId: string; folio: number }, 'comandaId'>;
  meta!: EntityTable<{ clave: string; valor: number }, 'clave'>;

  constructor(nombre = 'lena') {
    super(nombre);
    this.version(1).stores({
      eventos: 'id, enCola, hlc',
      conflictos: '++n',
      folios: 'comandaId',
      meta: 'clave',
    });
  }
}

function sinCola(f: EventoFila): EventoCable {
  const { enCola: _enCola, ...cable } = f;
  return cable;
}

export class AlmacenDexie implements Almacen {
  private readonly db: BaseLena;

  constructor(nombre?: string) {
    this.db = new BaseLena(nombre);
  }

  async encolar(e: EventoCable): Promise<void> {
    // add falla si ya existe (dedup por id); se ignora ese caso.
    await this.db.eventos.add({ ...e, enCola: 1 }).catch(() => undefined);
  }

  async pendientes(): Promise<EventoCable[]> {
    const filas = await this.db.eventos.where('enCola').equals(1).sortBy('hlc');
    return filas.map(sinCola);
  }

  async sacarDeCola(ids: readonly string[]): Promise<void> {
    await this.db.eventos.where('id').anyOf(ids as string[]).modify({ enCola: 0 });
  }

  async registrarRemotos(eventos: readonly EventoCable[]): Promise<void> {
    await this.db.transaction('rw', this.db.eventos, async () => {
      for (const e of eventos) {
        const existe = await this.db.eventos.get(e.id);
        // Uno que vuelve por pull ya está confirmado: enCola=0. Si no existía,
        // se guarda como remoto.
        if (existe) await this.db.eventos.update(e.id, { enCola: 0 });
        else await this.db.eventos.add({ ...e, enCola: 0 });
      }
    });
  }

  async log(): Promise<Evento[]> {
    const filas = await this.db.eventos.toArray();
    return filas.map((f) => aEventoDominio(sinCola(f)));
  }

  async cursor(): Promise<number> {
    return (await this.db.meta.get('cursor'))?.valor ?? 0;
  }

  async fijarCursor(seq: number): Promise<void> {
    const actual = await this.cursor();
    if (seq > actual) await this.db.meta.put({ clave: 'cursor', valor: seq });
  }

  async registrarConflicto(c: EventoRechazado): Promise<void> {
    await this.db.conflictos.add({ ...c, n: undefined as unknown as number });
  }

  async conflictos(): Promise<EventoRechazado[]> {
    return this.db.conflictos.toArray();
  }

  async guardarFolio(comandaId: string, folio: number): Promise<void> {
    await this.db.folios.put({ comandaId, folio });
  }

  async folios(): Promise<ReadonlyMap<string, number>> {
    const filas = await this.db.folios.toArray();
    return new Map(filas.map((f) => [f.comandaId, f.folio]));
  }

  // RS-L-2: al cerrar turno se purga lo ya sincronizado (nada en cola).
  async purgarSincronizado(): Promise<void> {
    await this.db.eventos.where('enCola').equals(0).delete();
  }

  async borrarTodo(): Promise<void> {
    await this.db.delete();
  }
}
