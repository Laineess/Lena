import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  esEstadoLineaTerminal,
  eventoPermitido,
  eventosPermitidosPara,
  generaMerma,
  resolverConflicto,
  transicionLineaValida,
} from './maquina-estados';
import type { EstadoLinea, Rol, TipoEvento } from './tipos';
import { formatearMoneda } from './tipos';

const ROLES: readonly Rol[] = ['administrador', 'cocina', 'mesero'];
const ESTADOS: readonly EstadoLinea[] = [
  'borrador',
  'pendiente',
  'en_preparacion',
  'lista',
  'cancelada',
];

// ── RS-Y-1: autorización de eventos ──────────────────────────

describe('RS-Y-1 — qué puede emitir cada rol', () => {
  it('un COCINERO no puede cobrar', () => {
    // El log es la fuente de verdad, así que un evento falsificado ES un
    // hecho falso. Sin esta validación en el push, un cocinero con acceso a
    // la API podría cobrar comandas.
    expect(eventoPermitido('comanda_cobrada', 'cocina')).toBe(false);
    expect(eventoPermitido('pago_registrado', 'cocina')).toBe(false);
  });

  it('un COCINERO no puede crear ni enviar comandas', () => {
    expect(eventoPermitido('comanda_creada', 'cocina')).toBe(false);
    expect(eventoPermitido('linea_agregada', 'cocina')).toBe(false);
    expect(eventoPermitido('comanda_enviada', 'cocina')).toBe(false);
  });

  it('un MESERO no puede marcar comandas listas', () => {
    expect(eventoPermitido('comanda_lista', 'mesero')).toBe(false);
    expect(eventoPermitido('linea_lista', 'mesero')).toBe(false);
  });

  it('un MESERO no puede reabrir una comanda cobrada', () => {
    // RF-G-8: reabrir es potestad del Administrador. Si el mesero pudiera,
    // podría cobrar, reabrir y quedarse el efectivo (T1).
    expect(eventoPermitido('comanda_reabierta', 'mesero')).toBe(false);
    expect(eventoPermitido('comanda_reabierta', 'cocina')).toBe(false);
    expect(eventoPermitido('comanda_reabierta', 'administrador')).toBe(true);
  });

  it('AMBOS roles pueden cancelar una línea, pero significan cosas distintas', () => {
    // RF-F-13: cocina cancela lo que no puede preparar.
    // La diferencia no está en el permiso, sino en generaMerma().
    expect(eventoPermitido('linea_cancelada', 'mesero')).toBe(true);
    expect(eventoPermitido('linea_cancelada', 'cocina')).toBe(true);
  });

  it('solo el mesero cancela la comanda COMPLETA', () => {
    expect(eventoPermitido('comanda_cancelada', 'cocina')).toBe(false);
    expect(eventoPermitido('comanda_cancelada', 'mesero')).toBe(true);
  });

  it('el ADMINISTRADOR puede todo lo que pueden los otros dos', () => {
    for (const rol of ['mesero', 'cocina'] as const) {
      for (const tipo of eventosPermitidosPara(rol)) {
        expect(eventoPermitido(tipo, 'administrador')).toBe(true);
      }
    }
  });

  it('ningún rol tiene permisos fuera de su lista', () => {
    const todos: TipoEvento[] = [
      'comanda_creada',
      'linea_agregada',
      'linea_modificada',
      'linea_eliminada',
      'comanda_enviada',
      'preparacion_iniciada',
      'linea_lista',
      'comanda_lista',
      'comanda_entregada',
      'pago_registrado',
      'comanda_cobrada',
      'comanda_cancelada',
      'linea_cancelada',
      'comanda_reabierta',
    ];
    for (const rol of ROLES) {
      const permitidos = eventosPermitidosPara(rol);
      for (const t of todos) {
        expect(eventoPermitido(t, rol)).toBe(permitidos.includes(t));
      }
    }
  });
});

// ── Separación de funciones (07 §4.1) ────────────────────────

describe('separación de funciones — el que cobra no puede ocultar merma', () => {
  it('el rol que cancela SIN merma no puede cobrar', () => {
    // Esta es la propiedad de seguridad que sale sola de la regla de negocio.
    // Si un mesero pudiera cancelar sin merma, podría tirar la comida y
    // hacerla desaparecer del reporte.
    for (const rol of ROLES) {
      const cancelaSinMerma = !generaMerma('pendiente', rol);
      if (cancelaSinMerma && rol !== 'administrador') {
        expect(eventoPermitido('comanda_cobrada', rol)).toBe(false);
      }
    }
  });
});

// ── Transiciones ─────────────────────────────────────────────

describe('transiciones de línea', () => {
  it('cancelada es terminal: no se sale de ahí', () => {
    for (const e of ESTADOS) {
      expect(transicionLineaValida('cancelada', e)).toBe(false);
    }
    expect(esEstadoLineaTerminal('cancelada')).toBe(true);
  });

  it('cualquier estado NO terminal puede cancelarse', () => {
    // La cancelación gana siempre (RF-E-21): el cliente ya se fue, y esa
    // realidad no se bloquea con una regla.
    for (const e of ESTADOS) {
      if (e !== 'cancelada') expect(transicionLineaValida(e, 'cancelada')).toBe(true);
    }
  });

  it('una línea no salta de borrador a lista sin pasar por cocina', () => {
    expect(transicionLineaValida('borrador', 'lista')).toBe(false);
    expect(transicionLineaValida('borrador', 'pendiente')).toBe(true);
  });

  it('una línea lista no vuelve a pendiente', () => {
    expect(transicionLineaValida('lista', 'pendiente')).toBe(false);
    expect(transicionLineaValida('lista', 'borrador')).toBe(false);
  });

  it('pendiente puede ir directo a lista (cocina tiene un solo botón)', () => {
    // El MVP no produce 'en_preparacion': la tarjeta de cocina tiene solo ✓.
    expect(transicionLineaValida('pendiente', 'lista')).toBe(true);
    // Pero la transición existe, para cuando se quiera medir la espera en cola.
    expect(transicionLineaValida('pendiente', 'en_preparacion')).toBe(true);
  });

  it('ninguna transición vuelve a borrador', () => {
    for (const e of ESTADOS) {
      if (e !== 'borrador') expect(transicionLineaValida(e, 'borrador')).toBe(false);
    }
  });
});

// ── La regla de la merma ─────────────────────────────────────

describe('generaMerma — propiedades', () => {
  it('cocina NUNCA genera merma, en ningún estado', () => {
    // Su cancelación significa "no pude prepararlo": esa comida nunca existió.
    fc.assert(
      fc.property(fc.constantFrom(...ESTADOS), (estado) => generaMerma(estado, 'cocina') === false),
    );
  });

  it('borrador NUNCA genera merma, para ningún rol', () => {
    // La línea no existió para nadie: cocina ni la vio.
    fc.assert(
      fc.property(fc.constantFrom(...ROLES), (rol) => generaMerma('borrador', rol) === false),
    );
  });

  it('mesero y admin SIEMPRE mermán lo que ya está en cocina', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('mesero' as const, 'administrador' as const),
        fc.constantFrom('pendiente' as const, 'en_preparacion' as const, 'lista' as const),
        (rol, estado) => generaMerma(estado, rol) === true,
      ),
    );
  });

  it('la frontera es exactamente el envío a cocina', () => {
    expect(generaMerma('borrador', 'mesero')).toBe(false);
    expect(generaMerma('pendiente', 'mesero')).toBe(true);
  });
});

// ── Conflictos (05 §5) ───────────────────────────────────────

describe('resolverConflicto', () => {
  it('la cancelación gana contra todo lo que no sea cobro', () => {
    expect(resolverConflicto('comanda_cancelada', 'comanda_lista')).toBe('gana_a');
    expect(resolverConflicto('comanda_lista', 'comanda_cancelada')).toBe('gana_b');
    expect(resolverConflicto('linea_cancelada', 'linea_lista')).toBe('gana_a');
    expect(resolverConflicto('comanda_cancelada', 'linea_agregada')).toBe('gana_a');
  });

  it('COBRADA gana contra la cancelación', () => {
    // El dinero ya entró, posiblemente en un turno cerrado (CU-06 F4).
    expect(resolverConflicto('comanda_cobrada', 'comanda_cancelada')).toBe('gana_a');
    expect(resolverConflicto('comanda_cancelada', 'comanda_cobrada')).toBe('gana_b');
  });

  it('solo una reapertura toca una comanda cobrada', () => {
    expect(resolverConflicto('comanda_cobrada', 'comanda_reabierta')).toBe('ambos');
  });

  it('dos modificaciones coexisten: gana el HLC mayor al plegar', () => {
    expect(resolverConflicto('linea_modificada', 'linea_modificada')).toBe('ambos');
  });

  it('dos cancelaciones coexisten: el resultado es el mismo', () => {
    expect(resolverConflicto('linea_cancelada', 'comanda_cancelada')).toBe('ambos');
  });

  it('es simétrico', () => {
    const tipos: TipoEvento[] = [
      'comanda_cancelada',
      'linea_cancelada',
      'comanda_cobrada',
      'comanda_lista',
      'linea_modificada',
      'comanda_reabierta',
    ];
    fc.assert(
      fc.property(fc.constantFrom(...tipos), fc.constantFrom(...tipos), (a, b) => {
        const ab = resolverConflicto(a, b);
        const ba = resolverConflicto(b, a);
        if (ab === 'ambos') return ba === 'ambos';
        if (ab === 'gana_a') return ba === 'gana_b';
        if (ab === 'gana_b') return ba === 'gana_a';
        return ab === ba;
      }),
    );
  });
});

describe('formato de moneda', () => {
  it('formatea centavos como pesos', () => {
    expect(formatearMoneda(5400)).toBe('$54.00');
    expect(formatearMoneda(0)).toBe('$0.00');
    expect(formatearMoneda(5)).toBe('$0.05');
  });
});
