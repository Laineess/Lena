import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatearHlc } from './hlc';
import { eventoPermitido } from './maquina-estados';
import { EsquemaEvento, EsquemaPull, EsquemaPush, LOTE_MAXIMO, aEventoDominio } from './protocolo';
import { plegarComanda } from './proyector';
import type { Evento } from './tipos';

const UUID_A = '018f1a2b-0000-7000-8000-000000000001';
const UUID_B = '018f1a2b-0000-7000-8000-000000000002';
const UUID_C = '018f1a2b-0000-7000-8000-000000000003';
const UUID_D = '018f1a2b-0000-7000-8000-000000000004';
const UUID_E = '018f1a2b-0000-7000-8000-000000000005';

const base = {
  id: UUID_A,
  comandaId: UUID_B,
  sucursalId: UUID_C,
  actorId: UUID_D,
  dispositivoId: UUID_E,
  rolActor: 'mesero' as const,
  hlc: formatearHlc({ fisico: 1_700_000_000_000, logico: 0, nodo: 'A' }),
  tsCliente: '2026-07-16T20:00:00.000Z',
};

// ── EL CONTROL ANTIFRAUDE ────────────────────────────────────

describe('T1 — un evento no puede decirle una cosa a la autorización y otra al proyector', () => {
  // ESTA es la prueba que justifica todo el archivo protocolo.ts.
  //
  // El sistema lee el tipo del evento en DOS lugares distintos:
  //   eventoPermitido(e.tipo, ...)  → autoriza mirando `tipo`
  //   aplicar() → switch (e.payload.tipo) → actúa según `payload`
  //
  // Mientras fueron campos independientes, un cocinero podía mandar
  // tipo:'linea_lista' (que sí tiene permitido) con payload:'comanda_cobrada'
  // y COBRAR LA COMANDA. Se verificó: el proyector devolvía 'cobrada'.

  const eventoMalicioso = {
    ...base,
    rolActor: 'cocina',
    tipo: 'linea_lista', // lo que ve la autorización — permitido para cocina
    payload: { tipo: 'comanda_cobrada' }, // lo que ejecuta el proyector
  };

  it('la autorización SOLA no lo detiene — por eso el esquema no es opcional', () => {
    // Documenta por qué eventoPermitido() no basta: mirando `tipo`, este
    // evento es legítimo. El engaño vive en la incoherencia, no en el permiso.
    expect(eventoPermitido('linea_lista', 'cocina')).toBe(true);
  });

  it('el esquema lo rechaza en la frontera', () => {
    const r = EsquemaEvento.safeParse(eventoMalicioso);
    expect(r.success).toBe(false);
  });

  it('ningún tipo acepta el payload de otro tipo', () => {
    // La versión general: no basta con tapar el caso del cocinero cobrando.
    const tipos = [
      'comanda_creada',
      'linea_eliminada',
      'comanda_enviada',
      'preparacion_iniciada',
      'linea_lista',
      'comanda_lista',
      'comanda_entregada',
      'comanda_cobrada',
    ] as const;

    fc.assert(
      fc.property(fc.constantFrom(...tipos), fc.constantFrom(...tipos), (tipo, tipoPayload) => {
        const r = EsquemaEvento.safeParse({ ...base, tipo, payload: { tipo: tipoPayload } });
        // Solo pasa si coinciden (y si ese tipo no exige campos extra).
        if (tipo !== tipoPayload) return r.success === false;
        return true;
      }),
      { numRuns: 500 },
    );
  });

  it('un evento coherente sí pasa y llega intacto al dominio', () => {
    // Sin esto, "todo rechazado" también pasaría las pruebas de arriba.
    const bueno = { ...base, tipo: 'comanda_cobrada', payload: { tipo: 'comanda_cobrada' } };
    const r = EsquemaEvento.safeParse(bueno);
    expect(r.success).toBe(true);
  });
});

// ── RS-Y-4: ts_cliente no es confiable ───────────────────────

describe('aEventoDominio', () => {
  it('descarta tsCliente: el dominio no puede verlo (RS-Y-4)', () => {
    // Si el dominio pudiera leerlo, alguien acabaría ordenando por ahí — y el
    // orden lo decide el HLC. Un mesero con el reloj movido reordenaría el log.
    const cable = EsquemaEvento.parse({
      ...base,
      tipo: 'comanda_enviada',
      payload: { tipo: 'comanda_enviada' },
    });
    const dominio = aEventoDominio(cable);
    expect('tsCliente' in dominio).toBe(false);
    expect(dominio.hlc).toBe(base.hlc);
  });

  it('lo que sale de aEventoDominio lo pliega el proyector sin adaptadores', () => {
    // RNF-M-7: el cable y el dominio comparten tipos. Si hiciera falta un
    // adaptador, cliente y servidor acabarían con dos versiones de la verdad.
    const eventos = [
      EsquemaEvento.parse({
        ...base,
        tipo: 'comanda_creada',
        payload: { tipo: 'comanda_creada', tipoServicio: 'para_llevar' },
      }),
      EsquemaEvento.parse({
        ...base,
        id: UUID_E,
        detalleId: UUID_A,
        hlc: formatearHlc({ fisico: 1_700_000_000_001, logico: 0, nodo: 'A' }),
        tipo: 'linea_agregada',
        payload: {
          tipo: 'linea_agregada',
          productoId: UUID_C,
          nombreProducto: 'Taco árabe',
          precioUnitario: 1800,
          cantidad: 3,
        },
      }),
    ].map(aEventoDominio) as Evento[];

    const c = plegarComanda(UUID_B, eventos);
    expect(c?.total).toBe(5400);
    expect(c?.estado).toBe('borrador');
  });
});

// ── El HLC en el cable ───────────────────────────────────────

describe('esquemaHlc — la última defensa del orden lexicográfico', () => {
  it('rechaza un HLC con el contador fuera de ancho', () => {
    // El ancho fijo sostiene el orden en Postgres (`hlc` es text). Un HLC con
    // 5 dígitos en el contador ordenaría mal, en silencio, para siempre —
    // dentro de un log que no admite UPDATE.
    const malos = [
      '0000018bcfe56800-00000-A', // logico de 5 dígitos → rompe el ancho
      '0000018bcfe56800-000-A', // logico de 3
      '018bcfe56800-0000-A', // fisico de 12, no 16
      '0000018bcfe56800-000g-A', // 'g' no es hex
      '0000018BCFE56800-0000-A', // hex en mayúsculas: ordena distinto que minúsculas
      'basura',
      '0000018bcfe56800-0000-', // sin nodo
      '0000018bcfe56800-0000-A B', // nodo con espacio
      '0000018bcfe56800-0000-AAAAAAAAAAAAAAAAA', // nodo de 17
    ];
    for (const hlc of malos) {
      const r = EsquemaEvento.safeParse({
        ...base,
        hlc,
        tipo: 'comanda_enviada',
        payload: { tipo: 'comanda_enviada' },
      });
      expect(r.success, `debió rechazar: ${hlc}`).toBe(false);
    }
  });

  it('acepta el HLC que genera formatearHlc, incluido el contador al tope', () => {
    // El control: si el regex rechazara todo, las pruebas de arriba pasarían igual.
    for (const logico of [0, 1, 0xffff]) {
      const hlc = formatearHlc({ fisico: 1_700_000_000_000, logico, nodo: 'A7' });
      const r = EsquemaEvento.safeParse({
        ...base,
        hlc,
        tipo: 'comanda_enviada',
        payload: { tipo: 'comanda_enviada' },
      });
      expect(r.success, `debió aceptar: ${hlc}`).toBe(true);
    }
  });
});

// ── Dinero en el cable (RNF-I-8) ─────────────────────────────

describe('dinero — el cable no deja entrar lo que la base rechazaría', () => {
  const pago = (monto: unknown) =>
    EsquemaEvento.safeParse({
      ...base,
      tipo: 'pago_registrado',
      payload: { tipo: 'pago_registrado', metodo: 'efectivo', monto, recibido: 10000 },
    });

  it('rechaza montos no enteros, negativos, NaN e Infinity', () => {
    // Los centavos son enteros (RNF-I-8). Un 18.5 aquí acabaría en un
    // numeric(10,2) redondeado y el corte de caja fallaría por un centavo
    // que nadie podría explicar.
    for (const malo of [18.5, -100, 0, Number.NaN, Number.POSITIVE_INFINITY, '1800']) {
      expect(pago(malo).success, `debió rechazar: ${String(malo)}`).toBe(false);
    }
  });

  it('acepta un monto entero positivo', () => {
    expect(pago(5400).success).toBe(true);
  });

  it('rechaza una cantidad de cero o negativa en una línea', () => {
    for (const cantidad of [0, -3, 1.5]) {
      const r = EsquemaEvento.safeParse({
        ...base,
        detalleId: UUID_A,
        tipo: 'linea_agregada',
        payload: {
          tipo: 'linea_agregada',
          productoId: UUID_C,
          nombreProducto: 'Taco',
          precioUnitario: 1800,
          cantidad,
        },
      });
      expect(r.success, `debió rechazar cantidad ${cantidad}`).toBe(false);
    }
  });
});

// ── Motivos (RS-U-3) ─────────────────────────────────────────

describe('motivos', () => {
  it('una cancelación sin motivo no entra', () => {
    // El motivo es lo que hace auditable la cancelación. Sin él, la merma es
    // un número sin explicación — y esa explicación es el control (07 §1).
    for (const motivo of ['', '   ', undefined]) {
      const r = EsquemaEvento.safeParse({
        ...base,
        tipo: 'comanda_cancelada',
        payload: { tipo: 'comanda_cancelada', motivo },
      });
      expect(r.success).toBe(false);
    }
  });
});

// ── Lote (RS-T-8) ────────────────────────────────────────────

describe('EsquemaPush', () => {
  const unEvento = { ...base, tipo: 'comanda_enviada', payload: { tipo: 'comanda_enviada' } };

  it('rechaza un lote vacío y uno gigante', () => {
    // El tope es una defensa de memoria, no de rendimiento: el VPS tiene
    // 1 vCPU y 2 GB (12 §1) y ahí viven otros dos proyectos.
    expect(EsquemaPush.safeParse({ dispositivoId: UUID_E, eventos: [] }).success).toBe(false);
    const gigante = Array.from({ length: LOTE_MAXIMO + 1 }, () => unEvento);
    expect(EsquemaPush.safeParse({ dispositivoId: UUID_E, eventos: gigante }).success).toBe(false);
  });

  it('acepta un lote justo en el tope', () => {
    const alTope = Array.from({ length: LOTE_MAXIMO }, () => unEvento);
    expect(EsquemaPush.safeParse({ dispositivoId: UUID_E, eventos: alTope }).success).toBe(true);
  });
});

describe('EsquemaPull', () => {
  it('el cursor por defecto es 0: un dispositivo nuevo jala todo', () => {
    const r = EsquemaPull.parse({ sucursalId: UUID_C });
    expect(r.desde).toBe(0);
  });

  it('coacciona los números que llegan como texto en la query string', () => {
    const r = EsquemaPull.parse({ sucursalId: UUID_C, desde: '42', limite: '10' });
    expect(r.desde).toBe(42);
    expect(r.limite).toBe(10);
  });

  it('rechaza un cursor negativo y un límite fuera de rango', () => {
    expect(EsquemaPull.safeParse({ sucursalId: UUID_C, desde: -1 }).success).toBe(false);
    expect(EsquemaPull.safeParse({ sucursalId: UUID_C, limite: 100_000 }).success).toBe(false);
    expect(EsquemaPull.safeParse({ sucursalId: UUID_C, limite: 0 }).success).toBe(false);
  });
});
