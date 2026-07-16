// Construcción de eventos del lado del mesero. El reloj HLC vive aquí, en la
// sesión: cada evento propio avanza el reloj (ADR-003).
import { v7 as uuidv7 } from 'uuid';
import { EsquemaEvento, RelojHlc } from '@lena/shared';
import type { EventoCable, TipoServicio } from '@lena/shared';

export interface Contexto {
  sucursalId: string;
  actorId: string;
  dispositivoId: string;
  // El nodo del HLC debe ser único por dispositivo y estable.
  nodo: string;
}

export interface LineaBorrador {
  productoId: string;
  nombreProducto: string;
  precioUnitario: number; // centavos
  cantidad: number;
  notas?: string;
}

export class ConstructorEventos {
  private readonly reloj: RelojHlc;

  constructor(private readonly ctx: Contexto) {
    this.reloj = new RelojHlc(ctx.nodo);
  }

  private base(comandaId: string, detalleId?: string) {
    return {
      id: uuidv7(),
      comandaId,
      ...(detalleId ? { detalleId } : {}),
      sucursalId: this.ctx.sucursalId,
      actorId: this.ctx.actorId,
      rolActor: 'mesero' as const,
      dispositivoId: this.ctx.dispositivoId,
      hlc: this.reloj.ahora(),
      tsCliente: new Date().toISOString(),
    };
  }

  // Arma la comanda completa a enviar: creación + líneas + envío a cocina.
  // Se valida con EsquemaEvento: si algo está mal, se descubre aquí y no en el
  // servidor (el mismo contrato en ambos lados, RNF-M-7).
  armarComanda(
    tipoServicio: TipoServicio,
    lineas: readonly LineaBorrador[],
    opts: { mesaId?: string } = {},
  ): { comandaId: string; eventos: EventoCable[] } {
    const comandaId = uuidv7();
    const eventos: EventoCable[] = [];

    eventos.push(
      EsquemaEvento.parse({
        ...this.base(comandaId),
        tipo: 'comanda_creada',
        payload: { tipo: 'comanda_creada', tipoServicio, ...(opts.mesaId ? { mesaId: opts.mesaId } : {}) },
      }),
    );

    for (const l of lineas) {
      eventos.push(
        EsquemaEvento.parse({
          ...this.base(comandaId, uuidv7()),
          tipo: 'linea_agregada',
          payload: {
            tipo: 'linea_agregada',
            productoId: l.productoId,
            nombreProducto: l.nombreProducto,
            precioUnitario: l.precioUnitario,
            cantidad: l.cantidad,
            ...(l.notas ? { notas: l.notas } : {}),
          },
        }),
      );
    }

    eventos.push(
      EsquemaEvento.parse({ ...this.base(comandaId), tipo: 'comanda_enviada', payload: { tipo: 'comanda_enviada' } }),
    );

    return { comandaId, eventos };
  }
}
