import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EsquemaEvento, RelojHlc } from '@lena/shared';
import type {
  EventoCable,
  PayloadEvento,
  PeticionPull,
  PeticionPush,
  RespuestaPull,
  RespuestaPush,
} from '@lena/shared';
import { MemoriaAlmacen } from './almacen';
import { MotorSync } from './motor-sync';
import { ErrorRed } from './transporte';
import type { Transporte } from './transporte';

const SUC = randomUUID();
const DISP = randomUUID();

function nuevoEvento(comandaId: string, payload: PayloadEvento, reloj: RelojHlc, detalleId?: string): EventoCable {
  return EsquemaEvento.parse({
    id: randomUUID(),
    comandaId,
    ...(detalleId ? { detalleId } : {}),
    sucursalId: SUC,
    tipo: payload.tipo,
    payload,
    actorId: randomUUID(),
    rolActor: 'mesero',
    dispositivoId: DISP,
    hlc: reloj.ahora(),
    tsCliente: new Date().toISOString(),
  });
}

// Servidor mínimo en memoria: solo la mecánica (dedup por id, seq creciente).
// La lógica real de negocio se prueba contra Postgres en apps/api.
class ServidorFalso implements Transporte {
  private readonly log = new Map<string, EventoCable & { seq: number }>();
  private seq = 0;
  caido = false;

  async push(p: PeticionPush): Promise<RespuestaPush> {
    if (this.caido) throw new ErrorRed();
    const aceptados: string[] = [];
    for (const e of p.eventos) {
      if (!this.log.has(e.id)) this.log.set(e.id, { ...e, seq: ++this.seq });
      aceptados.push(e.id); // dup también = éxito
    }
    return { aceptados, rechazados: [], folios: [], seq: this.seq };
  }

  async pull(p: PeticionPull): Promise<RespuestaPull> {
    if (this.caido) throw new ErrorRed();
    const eventos = [...this.log.values()].filter((e) => e.seq > p.desde).sort((a, b) => a.seq - b.seq);
    return { eventos, seq: eventos.at(-1)?.seq ?? p.desde, hayMas: false };
  }
}

describe('MotorSync', () => {
  it('encolar funciona sin red', async () => {
    const srv = new ServidorFalso();
    srv.caido = true;
    const motor = new MotorSync(new MemoriaAlmacen(), srv, { sucursalId: SUC, dispositivoId: DISP });
    const reloj = new RelojHlc('A');

    const cid = randomUUID();
    await motor.crear(nuevoEvento(cid, { tipo: 'comanda_creada', tipoServicio: 'para_llevar' }, reloj));
    expect(await motor.pendientes()).toBe(1);

    // Con la red caída, sincronizar no revienta y la cola se conserva.
    expect((await motor.sincronizar()).ok).toBe(false);
    expect(await motor.pendientes()).toBe(1);
  });

  it('drenar vacía la cola cuando hay red', async () => {
    const srv = new ServidorFalso();
    const motor = new MotorSync(new MemoriaAlmacen(), srv, { sucursalId: SUC, dispositivoId: DISP });
    const reloj = new RelojHlc('A');
    const cid = randomUUID();

    await motor.crear(nuevoEvento(cid, { tipo: 'comanda_creada', tipoServicio: 'para_llevar' }, reloj));
    await motor.crear(
      nuevoEvento(
        cid,
        { tipo: 'linea_agregada', productoId: randomUUID(), nombreProducto: 'Pastor', precioUnitario: 1800, cantidad: 2 },
        reloj,
        randomUUID(),
      ),
    );

    expect((await motor.sincronizar()).ok).toBe(true);
    expect(await motor.pendientes()).toBe(0);

    const c = await motor.comanda(cid);
    expect(c?.total).toBe(3600);
  });

  it('lo confirmado no se reenvía aunque vuelva por pull', async () => {
    const srv = new ServidorFalso();
    const motor = new MotorSync(new MemoriaAlmacen(), srv, { sucursalId: SUC, dispositivoId: DISP });
    const reloj = new RelojHlc('A');
    const cid = randomUUID();

    await motor.crear(nuevoEvento(cid, { tipo: 'comanda_creada', tipoServicio: 'para_llevar' }, reloj));
    await motor.sincronizar();
    await motor.jalar(); // el evento vuelve del servidor
    expect(await motor.pendientes()).toBe(0);
  });

  it('un rechazo de negocio sale de la cola y queda como conflicto', async () => {
    const almacen = new MemoriaAlmacen();
    const srv: Transporte = {
      async push(p) {
        return {
          aceptados: [],
          rechazados: p.eventos.map((e) => ({ id: e.id, razon: 'rol_no_autorizado' as const, detalle: 'no' })),
          folios: [],
          seq: 0,
        };
      },
      async pull() {
        return { eventos: [], seq: 0, hayMas: false };
      },
    };
    const motor = new MotorSync(almacen, srv, { sucursalId: SUC, dispositivoId: DISP });
    const reloj = new RelojHlc('A');

    await motor.crear(nuevoEvento(randomUUID(), { tipo: 'comanda_creada', tipoServicio: 'para_llevar' }, reloj));
    await motor.sincronizar();

    expect(await motor.pendientes()).toBe(0); // no se reintenta para siempre
    expect(await almacen.conflictos()).toHaveLength(1);
  });
});
