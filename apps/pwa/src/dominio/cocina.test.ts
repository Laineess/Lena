import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EsquemaEvento, aEventoDominio, parsearHlc } from '@lena/shared';
import type { Evento, EventoCable } from '@lena/shared';
import {
  comandasCanceladas,
  comandasEnCocina,
  hlcMaximo,
  inicioEspera,
  lineasPendientes,
  lineasServidas,
  tierPorMinutos,
} from './cocina';
import { ConstructorEventos } from './eventos';

const ctxBase = {
  sucursalId: '018f1a2b-0000-7000-8000-000000000001',
  actorId: '018f1a2b-0000-7000-8000-000000000002',
  dispositivoId: '018f1a2b-0000-7000-8000-000000000003',
};
const mesero = () => new ConstructorEventos({ ...ctxBase, nodo: 'A', rol: 'mesero' });
const cocina = () => new ConstructorEventos({ ...ctxBase, nodo: 'K', rol: 'cocina' });

const linea = {
  productoId: '018f1a2b-0000-7000-8000-000000000009',
  nombreProducto: 'Pastor',
  precioUnitario: 1800,
  cantidad: 3,
};

const dom = (e: readonly EventoCable[]): Evento[] => e.map(aEventoDominio);

// Evento de cancelación de comanda por el mesero (aún no hay método en el
// constructor; llega en la fase de cobro/cancelación).
function cancelarComanda(comandaId: string, hlcFisico: number, motivo: string): EventoCable {
  return EsquemaEvento.parse({
    id: randomUUID(),
    comandaId,
    sucursalId: ctxBase.sucursalId,
    actorId: ctxBase.actorId,
    rolActor: 'mesero',
    dispositivoId: ctxBase.dispositivoId,
    hlc: `${hlcFisico.toString(16).padStart(16, '0')}-0000-A`,
    tsCliente: new Date().toISOString(),
    tipo: 'comanda_cancelada',
    payload: { tipo: 'comanda_cancelada', motivo },
  });
}

describe('tierPorMinutos (RF-F-7)', () => {
  it('cruza los cuatro umbrales con el default', () => {
    expect(tierPorMinutos(0)).toBe('gris');
    expect(tierPorMinutos(1.9)).toBe('gris');
    expect(tierPorMinutos(2)).toBe('amarillo');
    expect(tierPorMinutos(5)).toBe('naranja');
    expect(tierPorMinutos(8)).toBe('rojo');
    expect(tierPorMinutos(20)).toBe('rojo');
  });

  it('respeta umbrales configurables por sucursal (RF-F-8)', () => {
    const rapida = { amarillo: 1, naranja: 3, rojo: 5 };
    expect(tierPorMinutos(1, rapida)).toBe('amarillo');
    expect(tierPorMinutos(3, rapida)).toBe('naranja');
    expect(tierPorMinutos(5, rapida)).toBe('rojo');
    // Con el default, 5 min sería solo naranja.
    expect(tierPorMinutos(5)).toBe('naranja');
  });
});

describe('comandasEnCocina', () => {
  it('una comanda enviada aparece; marcada lista desaparece', () => {
    const m = mesero();
    const { comandaId, eventos } = m.armarComanda('para_llevar', [linea]);
    expect(comandasEnCocina(dom(eventos))).toHaveLength(1);

    // Cocina observa lo recibido antes de marcar (causalidad, ADR-003).
    const c = cocina();
    c.observar(hlcMaximo(dom(eventos), comandaId));
    const lista = c.marcarLista(comandaId);
    expect(comandasEnCocina(dom([...eventos, lista]))).toHaveLength(0);
  });

  it('separa líneas pendientes de servidas', () => {
    const { eventos } = mesero().armarComanda('para_llevar', [linea]);
    const [comanda] = comandasEnCocina(dom(eventos));
    expect(lineasPendientes(comanda!)).toHaveLength(1);
    expect(lineasServidas(comanda!)).toHaveLength(0);
  });
});

describe('inicioEspera — el reloj se reinicia en una comanda que regresa (09 §6.3)', () => {
  it('tras marcar lista y agregar, el reloj arranca en la línea nueva', () => {
    const m = mesero();
    const { comandaId, eventos } = m.armarComanda('para_llevar', [linea]);
    const c = cocina();
    c.observar(hlcMaximo(dom(eventos), comandaId));
    const lista = c.marcarLista(comandaId);
    // El mesero también observa la marca de cocina antes de agregar.
    m.observar(lista.hlc);
    const adicion = m.agregarLineas(comandaId, [{ ...linea, cantidad: 1 }]);

    const [comanda] = comandasEnCocina(dom([...eventos, lista, ...adicion]));
    expect(lineasServidas(comanda!)).toHaveLength(1); // la vieja, tachada
    expect(lineasPendientes(comanda!)).toHaveLength(1); // la nueva, destacada

    const nueva = lineasPendientes(comanda!)[0]!;
    expect(inicioEspera(comanda!)).toBe(parsearHlc(nueva.enviadaHlc as string).fisico);
  });
});

describe('comandasCanceladas (RF-F-11)', () => {
  it('aparece cuando se cancela, con su motivo, y no antes', () => {
    const { comandaId, eventos } = mesero().armarComanda('para_llevar', [linea]);
    expect(comandasCanceladas(dom(eventos))).toHaveLength(0);

    const cancel = cancelarComanda(comandaId, Date.now() + 10_000, 'el cliente se fue');
    const res = comandasCanceladas(dom([...eventos, cancel]));
    expect(res).toHaveLength(1);
    expect(res[0]?.motivo).toBe('el cliente se fue');
  });
});
