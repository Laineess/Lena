import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EsquemaEvento, RelojHlc, plegarComanda } from '@lena/shared';
import type { EventoCable, PayloadEvento } from '@lena/shared';
import { AlmacenDexie } from './almacen-dexie';

const SUC = randomUUID();
let almacen: AlmacenDexie;
const reloj = new RelojHlc('A');

function ev(comandaId: string, payload: PayloadEvento, detalleId?: string): EventoCable {
  return EsquemaEvento.parse({
    id: randomUUID(),
    comandaId,
    ...(detalleId ? { detalleId } : {}),
    sucursalId: SUC,
    tipo: payload.tipo,
    payload,
    actorId: randomUUID(),
    rolActor: 'mesero',
    dispositivoId: randomUUID(),
    hlc: reloj.ahora(),
    tsCliente: new Date().toISOString(),
  });
}

beforeEach(() => {
  almacen = new AlmacenDexie(`prueba-${randomUUID()}`);
});

afterEach(async () => {
  await almacen.borrarTodo();
});

describe('AlmacenDexie', () => {
  it('encolar deja el evento pendiente y en el log', async () => {
    const cid = randomUUID();
    await almacen.encolar(ev(cid, { tipo: 'comanda_creada', tipoServicio: 'para_llevar' }));
    expect(await almacen.pendientes()).toHaveLength(1);
    expect(await almacen.log()).toHaveLength(1);
  });

  it('encolar el mismo id dos veces no duplica', async () => {
    const cid = randomUUID();
    const e = ev(cid, { tipo: 'comanda_creada', tipoServicio: 'para_llevar' });
    await almacen.encolar(e);
    await almacen.encolar(e);
    expect(await almacen.log()).toHaveLength(1);
  });

  it('pendientes salen ordenados por HLC', async () => {
    const cid = randomUUID();
    const e1 = ev(cid, { tipo: 'comanda_creada', tipoServicio: 'para_llevar' });
    const e2 = ev(cid, { tipo: 'comanda_enviada' });
    // Se encolan al revés; deben salir por HLC.
    await almacen.encolar(e2);
    await almacen.encolar(e1);
    const p = await almacen.pendientes();
    expect(p.map((x) => x.id)).toEqual([e1.id, e2.id]);
  });

  it('sacarDeCola quita del outbox pero conserva en el log', async () => {
    const cid = randomUUID();
    const e = ev(cid, { tipo: 'comanda_creada', tipoServicio: 'para_llevar' });
    await almacen.encolar(e);
    await almacen.sacarDeCola([e.id]);
    expect(await almacen.pendientes()).toHaveLength(0);
    expect(await almacen.log()).toHaveLength(1);
  });

  it('registrarRemotos agrega eventos ajenos y no los pone en cola', async () => {
    const cid = randomUUID();
    const remoto = ev(cid, { tipo: 'comanda_creada', tipoServicio: 'para_llevar' });
    await almacen.registrarRemotos([remoto]);
    expect(await almacen.pendientes()).toHaveLength(0);
    expect(await almacen.log()).toHaveLength(1);
  });

  it('un evento propio que vuelve por pull sale de la cola', async () => {
    const cid = randomUUID();
    const e = ev(cid, { tipo: 'comanda_creada', tipoServicio: 'para_llevar' });
    await almacen.encolar(e);
    await almacen.registrarRemotos([e]); // el servidor lo devuelve
    expect(await almacen.pendientes()).toHaveLength(0);
    expect(await almacen.log()).toHaveLength(1); // sin duplicar
  });

  it('el cursor nunca retrocede', async () => {
    await almacen.fijarCursor(10);
    await almacen.fijarCursor(5);
    expect(await almacen.cursor()).toBe(10);
  });

  it('folios y conflictos se guardan y se leen', async () => {
    const cid = randomUUID();
    await almacen.guardarFolio(cid, 42);
    expect((await almacen.folios()).get(cid)).toBe(42);
    await almacen.registrarConflicto({ id: 'x', razon: 'rol_no_autorizado', detalle: 'no' });
    expect(await almacen.conflictos()).toHaveLength(1);
  });

  it('el log persistido pliega la misma comanda que el dominio', async () => {
    const cid = randomUUID();
    const det = randomUUID();
    await almacen.encolar(ev(cid, { tipo: 'comanda_creada', tipoServicio: 'para_llevar' }));
    await almacen.encolar(
      ev(cid, { tipo: 'linea_agregada', productoId: randomUUID(), nombreProducto: 'Pastor', precioUnitario: 1800, cantidad: 3 }, det),
    );
    const c = plegarComanda(cid, await almacen.log());
    expect(c?.total).toBe(5400);
  });

  it('purgarSincronizado borra lo confirmado y deja lo pendiente', async () => {
    const cid = randomUUID();
    const confirmado = ev(cid, { tipo: 'comanda_creada', tipoServicio: 'para_llevar' });
    const pendiente = ev(cid, { tipo: 'comanda_enviada' });
    await almacen.encolar(confirmado);
    await almacen.encolar(pendiente);
    await almacen.sacarDeCola([confirmado.id]);
    await almacen.purgarSincronizado();
    const log = await almacen.log();
    expect(log).toHaveLength(1);
    expect(log[0]?.id).toBe(pendiente.id);
  });
});
