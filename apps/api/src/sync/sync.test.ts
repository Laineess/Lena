import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { formatearHlc } from '@lena/shared';
import type { EventoCable } from '@lena/shared';
import { comanda, comandaDetalle, comandaDomicilio, comandaEvento } from '@lena/db';
import { procesarPull } from './pull';
import { procesarPush } from './push';
import { abrirTurno, app, cerrarConexiones, cerrarTurno, dispositivo, ID, limpiar } from './fixtures';

const uuid = () => randomUUID();

beforeEach(async () => {
  await limpiar();
  await abrirTurno();
});

afterAll(async () => {
  await cerrarConexiones();
});

// ── Push básico + materialización ────────────────────────────

describe('procesarPush — materialización', () => {
  it('crea la comanda, asigna folio y guarda el log', async () => {
    const cid = uuid();
    const did = uuid();
    const d = dispositivo('A');
    const eventos: EventoCable[] = [
      d.ev(cid, { tipo: 'comanda_creada', tipoServicio: 'para_llevar' }, { id: uuid() }),
      d.ev(
        cid,
        { tipo: 'linea_agregada', productoId: ID.pastor, nombreProducto: 'Pastor', precioUnitario: 1800, cantidad: 3 },
        { id: uuid(), detalleId: did },
      ),
    ];

    const r = await procesarPush(app.db, { dispositivoId: ID.tabletA, eventos });

    expect(r.aceptados).toHaveLength(2);
    expect(r.rechazados).toHaveLength(0);
    expect(r.folios).toEqual([{ comandaId: cid, folio: 1 }]);

    const [cab] = await app.db.select().from(comanda).where(eq(comanda.id, cid));
    expect(cab?.folio).toBe(1);
    expect(cab?.total).toBe('54.00'); // 3 × $18, snapshot (ADR-006)
    expect(cab?.estado).toBe('borrador');

    const log = await app.db.select().from(comandaEvento).where(eq(comandaEvento.comandaId, cid));
    expect(log).toHaveLength(2);
  });

  it('el folio incrementa por sucursal', async () => {
    const d = dispositivo('A');
    for (let i = 1; i <= 3; i++) {
      const cid = uuid();
      const r = await procesarPush(app.db, {
        dispositivoId: ID.tabletA,
        eventos: [d.ev(cid, { tipo: 'comanda_creada', tipoServicio: 'mesa', mesaId: ID.mesa1 }, { id: uuid() })],
      });
      expect(r.folios[0]?.folio).toBe(i);
    }
  });
});

// ── Idempotencia (RF-J-3) ────────────────────────────────────

describe('procesarPush — idempotencia', () => {
  it('reenviar el mismo lote no duplica nada', async () => {
    const cid = uuid();
    const d = dispositivo('A');
    const eventos: EventoCable[] = [
      d.ev(cid, { tipo: 'comanda_creada', tipoServicio: 'para_llevar' }, { id: uuid() }),
      d.ev(
        cid,
        { tipo: 'linea_agregada', productoId: ID.pastor, nombreProducto: 'Pastor', precioUnitario: 1800, cantidad: 2 },
        { id: uuid(), detalleId: uuid() },
      ),
    ];

    const r1 = await procesarPush(app.db, { dispositivoId: ID.tabletA, eventos });
    const r2 = await procesarPush(app.db, { dispositivoId: ID.tabletA, eventos });

    expect(r1.aceptados).toHaveLength(2);
    expect(r2.aceptados).toHaveLength(2); // dups = éxito, el cliente vacía outbox
    expect(r2.folios).toHaveLength(0); // ya tenía folio, no reasigna

    const log = await app.db.select().from(comandaEvento).where(eq(comandaEvento.comandaId, cid));
    expect(log).toHaveLength(2); // NO se duplicó
  });

  it('un id reusado con OTRO contenido se rechaza', async () => {
    const cid = uuid();
    const mismoId = uuid();
    const d = dispositivo('A');
    await procesarPush(app.db, {
      dispositivoId: ID.tabletA,
      eventos: [d.ev(cid, { tipo: 'comanda_creada', tipoServicio: 'para_llevar' }, { id: mismoId })],
    });

    // Mismo id, comanda distinta → intento de reescribir el log.
    const r = await procesarPush(app.db, {
      dispositivoId: ID.tabletA,
      eventos: [d.ev(cid, { tipo: 'comanda_creada', tipoServicio: 'mesa', mesaId: uuid() }, { id: mismoId })],
    });
    expect(r.rechazados[0]?.razon).toBe('duplicado_con_otro_contenido');
  });
});

// ── Autorización (RS-Y-1) ────────────────────────────────────

describe('procesarPush — autorización', () => {
  it('un cocinero no puede cobrar', async () => {
    const cid = uuid();
    const mesero = dispositivo('A');
    await procesarPush(app.db, {
      dispositivoId: ID.tabletA,
      eventos: [mesero.ev(cid, { tipo: 'comanda_creada', tipoServicio: 'para_llevar' }, { id: uuid() })],
    });

    const coci = dispositivo('K', { actorId: ID.cocinero, rolActor: 'cocina', dispositivoId: ID.tabletB });
    const r = await procesarPush(app.db, {
      dispositivoId: ID.tabletB,
      eventos: [coci.ev(cid, { tipo: 'comanda_cobrada' }, { id: uuid() })],
    });

    expect(r.aceptados).toHaveLength(0);
    expect(r.rechazados[0]?.razon).toBe('rol_no_autorizado');

    const [cab] = await app.db.select().from(comanda).where(eq(comanda.id, cid));
    expect(cab?.estado).not.toBe('cobrada'); // T1: NO se cobró
  });
});

// ── RF-H-3: sin turno abierto ────────────────────────────────

describe('procesarPush — turno', () => {
  it('rechaza crear comanda sin corte abierto', async () => {
    await cerrarTurno();
    const cid = uuid();
    const d = dispositivo('A');
    const r = await procesarPush(app.db, {
      dispositivoId: ID.tabletA,
      eventos: [d.ev(cid, { tipo: 'comanda_creada', tipoServicio: 'para_llevar' }, { id: uuid() })],
    });
    expect(r.rechazados[0]?.razon).toBe('sin_turno_abierto');
  });
});

// ── Deriva de reloj (RS-Y-4) ─────────────────────────────────

describe('procesarPush — deriva', () => {
  it('rechaza un evento con HLC muy en el futuro', async () => {
    const cid = uuid();
    const d = dispositivo('A');
    const futuro = formatearHlc({ fisico: Date.now() + 10 * 60_000, logico: 0, nodo: 'A' });
    const r = await procesarPush(app.db, {
      dispositivoId: ID.tabletA,
      eventos: [d.ev(cid, { tipo: 'comanda_creada', tipoServicio: 'para_llevar' }, { id: uuid(), hlc: futuro })],
    });
    expect(r.rechazados[0]?.razon).toBe('deriva_de_reloj');
  });
});

// ── El bug que arreglé: línea cancelada en borrador ──────────

describe('procesarPush — merma sin envío (regresión de 0003)', () => {
  it('materializa una línea cancelada que nunca se envió, sin reventar', async () => {
    const cid = uuid();
    const did = uuid();
    const d = dispositivo('A');
    const r = await procesarPush(app.db, {
      dispositivoId: ID.tabletA,
      eventos: [
        d.ev(cid, { tipo: 'comanda_creada', tipoServicio: 'para_llevar' }, { id: uuid() }),
        d.ev(
          cid,
          {
            tipo: 'linea_agregada',
            productoId: ID.pastor,
            nombreProducto: 'Pastor',
            precioUnitario: 1800,
            cantidad: 1,
          },
          { id: uuid(), detalleId: did },
        ),
        // Se cancela ANTES de enviar a cocina: enviadaAt debe quedar NULL.
        d.ev(cid, { tipo: 'linea_cancelada', motivo: 'el cliente se arrepintió' }, { id: uuid(), detalleId: did }),
      ],
    });
    expect(r.rechazados).toHaveLength(0);

    const [det] = await app.db.select().from(comandaDetalle).where(eq(comandaDetalle.id, did));
    expect(det?.estado).toBe('cancelada');
    expect(det?.enviadaAt).toBeNull();
  });
});

// ── Domicilio (RF-E-17) ──────────────────────────────────────

describe('procesarPush — domicilio', () => {
  it('materializa comanda_domicilio con los datos del cliente', async () => {
    const cid = uuid();
    const d = dispositivo('A');
    const r = await procesarPush(app.db, {
      dispositivoId: ID.tabletA,
      eventos: [
        d.ev(
          cid,
          {
            tipo: 'comanda_creada',
            tipoServicio: 'domicilio',
            domicilio: {
              nombreCliente: 'María',
              telefono: '7711234567',
              direccion: 'Juárez 45',
              referencias: 'portón verde',
            },
          },
          { id: uuid() },
        ),
      ],
    });
    expect(r.rechazados).toHaveLength(0);

    const [dom] = await app.db.select().from(comandaDomicilio).where(eq(comandaDomicilio.comandaId, cid));
    expect(dom?.telefono).toBe('7711234567');
    expect(dom?.direccion).toBe('Juárez 45');
    expect(dom?.referencias).toBe('portón verde');
  });
});

// ── Pull con cursor ──────────────────────────────────────────

describe('procesarPull', () => {
  it('devuelve los eventos por seq y avanza el cursor', async () => {
    const cid = uuid();
    const d = dispositivo('A');
    await procesarPush(app.db, {
      dispositivoId: ID.tabletA,
      eventos: [
        d.ev(cid, { tipo: 'comanda_creada', tipoServicio: 'para_llevar' }, { id: uuid() }),
        d.ev(
          cid,
          {
            tipo: 'linea_agregada',
            productoId: ID.pastor,
            nombreProducto: 'Pastor',
            precioUnitario: 1800,
            cantidad: 1,
          },
          { id: uuid(), detalleId: uuid() },
        ),
      ],
    });

    const p = await procesarPull(app.db, { sucursalId: ID.sucursal, desde: 0, limite: 500 });
    expect(p.eventos).toHaveLength(2);
    expect(p.hayMas).toBe(false);
    expect(p.seq).toBeGreaterThan(0);

    // Desde el cursor final ya no hay nada nuevo.
    const p2 = await procesarPull(app.db, { sucursalId: ID.sucursal, desde: p.seq, limite: 500 });
    expect(p2.eventos).toHaveLength(0);
  });

  it('pagina y reporta hayMas', async () => {
    const d = dispositivo('A');
    for (let i = 0; i < 5; i++) {
      await procesarPush(app.db, {
        dispositivoId: ID.tabletA,
        eventos: [d.ev(uuid(), { tipo: 'comanda_creada', tipoServicio: 'para_llevar' }, { id: uuid() })],
      });
    }
    const p = await procesarPull(app.db, { sucursalId: ID.sucursal, desde: 0, limite: 2 });
    expect(p.eventos).toHaveLength(2);
    expect(p.hayMas).toBe(true);
  });
});
