// Construcción de eventos del lado del mesero. El reloj HLC vive aquí, en la
// sesión: cada evento propio avanza el reloj (ADR-003).
import { v7 as uuidv7 } from 'uuid';
import { EsquemaEvento, RelojHlc } from '@lena/shared';
import type { Domicilio, EventoCable, Rol, TipoServicio } from '@lena/shared';

export interface Contexto {
  sucursalId: string;
  actorId: string;
  dispositivoId: string;
  // El nodo del HLC debe ser único por dispositivo y estable.
  nodo: string;
  // El rol del actor (mesero o cocina). Va en cada evento (RS-Y-1).
  rol: Rol;
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

  // Avanza el reloj más allá de un HLC ya visto (ADR-003). Sin esto, un evento
  // emitido por cocina —que reacciona a lo que le llegó por pull— podría
  // ordenarse ANTES de aquello a lo que reacciona (p. ej. `comanda_lista` antes
  // de que existan las líneas), sobre todo con relojes de tablet desfasados.
  // MotorSync.jalar guarda los remotos pero no toca este reloj; por eso se
  // observa explícitamente el máximo antes de emitir.
  observar(hlc: string | null | undefined): void {
    if (!hlc) return;
    try {
      this.reloj.recibir(hlc);
    } catch {
      // Deriva > límite o desbordamiento: no se adopta ese reloj, pero ahora()
      // seguirá generando HLC crecientes por su cuenta.
    }
  }

  private base(comandaId: string, detalleId?: string) {
    return {
      id: uuidv7(),
      comandaId,
      ...(detalleId ? { detalleId } : {}),
      sucursalId: this.ctx.sucursalId,
      actorId: this.ctx.actorId,
      rolActor: this.ctx.rol,
      dispositivoId: this.ctx.dispositivoId,
      hlc: this.reloj.ahora(),
      tsCliente: new Date().toISOString(),
    };
  }

  private lineaAgregada(comandaId: string, l: LineaBorrador): EventoCable {
    return EsquemaEvento.parse({
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
    });
  }

  // Arma la comanda completa a enviar: creación + líneas + envío a cocina.
  // Se valida con EsquemaEvento: si algo está mal, se descubre aquí y no en el
  // servidor (el mismo contrato en ambos lados, RNF-M-7).
  armarComanda(
    tipoServicio: TipoServicio,
    lineas: readonly LineaBorrador[],
    opts: { mesaId?: string; domicilio?: Domicilio } = {},
  ): { comandaId: string; eventos: EventoCable[] } {
    const comandaId = uuidv7();
    const eventos: EventoCable[] = [];

    eventos.push(
      EsquemaEvento.parse({
        ...this.base(comandaId),
        tipo: 'comanda_creada',
        payload: {
          tipo: 'comanda_creada',
          tipoServicio,
          ...(opts.mesaId ? { mesaId: opts.mesaId } : {}),
          ...(opts.domicilio ? { domicilio: opts.domicilio } : {}),
        },
      }),
    );

    for (const l of lineas) eventos.push(this.lineaAgregada(comandaId, l));

    eventos.push(
      EsquemaEvento.parse({ ...this.base(comandaId), tipo: 'comanda_enviada', payload: { tipo: 'comanda_enviada' } }),
    );

    return { comandaId, eventos };
  }

  // Adición a una comanda YA enviada (RF-E-7): nuevas líneas + un envío a
  // cocina. El proyector no reinicia las líneas anteriores (05 §4.3): las nuevas
  // salen en borrador y este envío solo las mueve a ellas.
  agregarLineas(comandaId: string, lineas: readonly LineaBorrador[]): EventoCable[] {
    const eventos = lineas.map((l) => this.lineaAgregada(comandaId, l));
    eventos.push(
      EsquemaEvento.parse({ ...this.base(comandaId), tipo: 'comanda_enviada', payload: { tipo: 'comanda_enviada' } }),
    );
    return eventos;
  }

  // ── Cocina (rol 'cocina') ──────────────────────────────────

  // El botón ✓: marca lista toda la comanda (RF-F-6). comanda_lista mueve a
  // 'lista' las líneas que estén pendientes; las ya listas no cambian.
  marcarLista(comandaId: string): EventoCable {
    return EsquemaEvento.parse({
      ...this.base(comandaId),
      tipo: 'comanda_lista',
      payload: { tipo: 'comanda_lista' },
    });
  }

  // "No puedo prepararla" (RF-F-13): cancela la línea SIN merma (la cancela
  // cocina; generaMerma() lo distingue por el rol, RF-F-14).
  cancelarLinea(comandaId: string, detalleId: string, motivo: string): EventoCable {
    return EsquemaEvento.parse({
      ...this.base(comandaId, detalleId),
      tipo: 'linea_cancelada',
      payload: { tipo: 'linea_cancelada', motivo },
    });
  }
}
