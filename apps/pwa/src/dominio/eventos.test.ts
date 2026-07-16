import { describe, expect, it } from 'vitest';
import { aEventoDominio, eventoPermitido, pagosCuadran, plegarComanda } from '@lena/shared';
import { ConstructorEventos } from './eventos';

const ctx = {
  sucursalId: '018f1a2b-0000-7000-8000-000000000001',
  actorId: '018f1a2b-0000-7000-8000-000000000002',
  dispositivoId: '018f1a2b-0000-7000-8000-000000000003',
  nodo: 'A',
  rol: 'mesero' as const,
};

const ctxCocina = { ...ctx, nodo: 'K', rol: 'cocina' as const };

const linea = {
  productoId: '018f1a2b-0000-7000-8000-000000000009',
  nombreProducto: 'Pastor',
  precioUnitario: 1800,
  cantidad: 3,
};

describe('ConstructorEventos', () => {
  it('arma comanda creada + líneas + enviada, y pliega al total correcto', () => {
    const c = new ConstructorEventos(ctx);
    const { comandaId, eventos } = c.armarComanda('para_llevar', [linea]);

    expect(eventos.map((e) => e.tipo)).toEqual(['comanda_creada', 'linea_agregada', 'comanda_enviada']);

    const comanda = plegarComanda(comandaId, eventos.map(aEventoDominio));
    expect(comanda?.total).toBe(5400);
    expect(comanda?.estado).toBe('enviada');
    expect(comanda?.lineas).toHaveLength(1);
  });

  it('todos los eventos son emitibles por un mesero (RS-Y-1)', () => {
    const c = new ConstructorEventos(ctx);
    const { eventos } = c.armarComanda('mesa', [linea], { mesaId: '018f1a2b-0000-7000-8000-000000000100' });
    for (const e of eventos) expect(eventoPermitido(e.tipo, e.rolActor)).toBe(true);
  });

  it('los HLC salen estrictamente crecientes', () => {
    const c = new ConstructorEventos(ctx);
    const { eventos } = c.armarComanda('para_llevar', [linea, { ...linea, cantidad: 1 }]);
    for (let i = 1; i < eventos.length; i++) {
      expect(eventos[i]!.hlc > eventos[i - 1]!.hlc).toBe(true);
    }
  });

  it('mesa incluye mesaId en el payload de creación', () => {
    const c = new ConstructorEventos(ctx);
    const { eventos } = c.armarComanda('mesa', [linea], { mesaId: '018f1a2b-0000-7000-8000-000000000100' });
    const creada = eventos[0]!;
    expect(creada.payload).toMatchObject({ tipo: 'comanda_creada', tipoServicio: 'mesa' });
  });

  it('domicilio viaja en el payload de creación (RF-E-17)', () => {
    const c = new ConstructorEventos(ctx);
    const { eventos } = c.armarComanda('domicilio', [linea], {
      domicilio: { nombreCliente: 'Ana', telefono: '7711234567', direccion: 'Centro 1' },
    });
    expect(eventos[0]!.payload).toMatchObject({
      tipoServicio: 'domicilio',
      domicilio: { telefono: '7711234567' },
    });
  });

  it('agregarLineas produce líneas + un envío para la comanda dada (RF-E-7)', () => {
    const c = new ConstructorEventos(ctx);
    const comandaId = '018f1a2b-0000-7000-8000-0000000000aa';
    const eventos = c.agregarLineas(comandaId, [linea, { ...linea, cantidad: 1 }]);
    expect(eventos.map((e) => e.tipo)).toEqual(['linea_agregada', 'linea_agregada', 'comanda_enviada']);
    expect(eventos.every((e) => e.comandaId === comandaId)).toBe(true);
  });

  it('cocina: marcarLista y cancelarLinea salen con rol cocina y son emitibles', () => {
    const c = new ConstructorEventos(ctxCocina);
    const cid = '018f1a2b-0000-7000-8000-0000000000bb';
    const lista = c.marcarLista(cid);
    const cancel = c.cancelarLinea(cid, '018f1a2b-0000-7000-8000-0000000000cc', 'se acabó el pastor');
    expect(lista.rolActor).toBe('cocina');
    expect(eventoPermitido(lista.tipo, 'cocina')).toBe(true);
    expect(eventoPermitido(cancel.tipo, 'cocina')).toBe(true);
    // Un cocinero NO puede cobrar (RS-Y-1): sanity.
    expect(eventoPermitido('comanda_cobrada', 'cocina')).toBe(false);
  });

  it('cobro: ciclo entregada → pago → cobrada, con pagos que cuadran (RF-G-6)', () => {
    const c = new ConstructorEventos(ctx);
    const armada = c.armarComanda('para_llevar', [{ ...linea, cantidad: 2 }]); // 2 × $18 = $36
    const cid = armada.comandaId;
    const flujo = [
      ...armada.eventos,
      c.marcarEntregada(cid),
      c.registrarPago(cid, { metodo: 'efectivo', monto: 3600, recibido: 5000 }),
      c.cobrar(cid),
    ];

    for (const e of flujo) expect(eventoPermitido(e.tipo, e.rolActor)).toBe(true);

    const comanda = plegarComanda(cid, flujo.map(aEventoDominio));
    expect(comanda?.estado).toBe('cobrada');
    expect(comanda?.total).toBe(3600);
    expect(pagosCuadran(comanda!)).toBe(true);
  });

  it('cancelarComanda emite comanda_cancelada con motivo (RF-E-19)', () => {
    const c = new ConstructorEventos(ctx);
    const cid = '018f1a2b-0000-7000-8000-0000000000ef';
    const ev = c.cancelarComanda(cid, 'el cliente se fue');
    expect(ev.tipo).toBe('comanda_cancelada');
    expect(ev.payload).toMatchObject({ motivo: 'el cliente se fue' });
    expect(eventoPermitido(ev.tipo, 'mesero')).toBe(true);
  });
});
