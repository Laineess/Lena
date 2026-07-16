import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  compararHlc,
  DERIVA_MAXIMA_MS,
  ErrorDerivaReloj,
  formatearHlc,
  parsearHlc,
  RelojHlc,
} from './hlc';

/** Reloj de pared controlable: sin esto las pruebas dependerían del tiempo real. */
function relojFalso(inicio = 1_700_000_000_000) {
  let t = inicio;
  return {
    ahora: () => t,
    avanzar: (ms: number) => (t += ms),
    retroceder: (ms: number) => (t -= ms),
    fijar: (ms: number) => (t = ms),
  };
}

describe('formato', () => {
  it('ida y vuelta', () => {
    const partes = { fisico: 1_700_000_000_000, logico: 42, nodo: 'A1B2' };
    expect(parsearHlc(formatearHlc(partes))).toEqual(partes);
  });

  it('rechaza HLC mal formados', () => {
    expect(() => parsearHlc('basura')).toThrow();
    expect(() => parsearHlc('abc-def')).toThrow();
    expect(() => parsearHlc('zzz-0000-A')).toThrow();
  });

  it('el orden lexicográfico coincide con el cronológico', () => {
    // Es la razón de los ceros a la izquierda: Postgres ordena como texto.
    const temprano = formatearHlc({ fisico: 999, logico: 0, nodo: 'A' });
    const tarde = formatearHlc({ fisico: 1000, logico: 0, nodo: 'A' });
    expect(temprano < tarde).toBe(true);
  });
});

describe('ahora()', () => {
  it('avanza aunque el reloj de pared no se mueva', () => {
    const reloj = relojFalso();
    const hlc = new RelojHlc('A', reloj.ahora);
    const a = hlc.ahora();
    const b = hlc.ahora();
    const c = hlc.ahora();
    expect(compararHlc(a, b)).toBeLessThan(0);
    expect(compararHlc(b, c)).toBeLessThan(0);
  });

  it('reinicia el contador lógico cuando el reloj de pared avanza', () => {
    const reloj = relojFalso();
    const hlc = new RelojHlc('A', reloj.ahora);

    hlc.ahora(); // fisico interno era 0 → salta al reloj de pared, logico = 0
    expect(hlc.estado().logico).toBe(0);

    hlc.ahora(); // el reloj de pared no se movió → logico = 1
    expect(hlc.estado().logico).toBe(1);

    hlc.ahora(); // sigue sin moverse → logico = 2
    expect(hlc.estado().logico).toBe(2);

    reloj.avanzar(1); // ahora sí avanzó
    hlc.ahora();
    expect(hlc.estado().logico).toBe(0);
  });

  it('sigue avanzando aunque el reloj se vaya HACIA ATRÁS', () => {
    // Pasa de verdad: un ajuste de NTP mueve el reloj al pasado. Sin el
    // contador lógico, dos eventos consecutivos saldrían desordenados.
    const reloj = relojFalso();
    const hlc = new RelojHlc('A', reloj.ahora);
    const antes = hlc.ahora();
    reloj.retroceder(5_000);
    const despues = hlc.ahora();
    expect(compararHlc(antes, despues)).toBeLessThan(0);
  });
});

describe('recibir()', () => {
  it('adopta el tiempo del remoto si va adelante', () => {
    const reloj = relojFalso();
    const hlc = new RelojHlc('A', reloj.ahora);
    const remoto = formatearHlc({ fisico: reloj.ahora() + 5_000, logico: 0, nodo: 'B' });
    const resultado = hlc.recibir(remoto);
    // El evento que recibe va DESPUÉS del que recibió: orden causal.
    expect(compararHlc(remoto, resultado)).toBeLessThan(0);
    expect(parsearHlc(resultado).fisico).toBe(parsearHlc(remoto).fisico);
  });

  it('no retrocede si el remoto va atrasado', () => {
    const reloj = relojFalso();
    const hlc = new RelojHlc('A', reloj.ahora);
    const propio = hlc.ahora();
    const remotoViejo = formatearHlc({ fisico: reloj.ahora() - 10_000, logico: 0, nodo: 'B' });
    const resultado = hlc.recibir(remotoViejo);
    expect(compararHlc(propio, resultado)).toBeLessThan(0);
  });

  it('rechaza un remoto demasiado del futuro', () => {
    // Una tablet con el reloj adelantado 3 días envenenaría el reloj de toda
    // la sucursal: los cronómetros de cocina quedarían absurdos por días.
    const reloj = relojFalso();
    const hlc = new RelojHlc('A', reloj.ahora);
    const delFuturo = formatearHlc({
      fisico: reloj.ahora() + DERIVA_MAXIMA_MS + 1,
      logico: 0,
      nodo: 'B',
    });
    expect(() => hlc.recibir(delFuturo)).toThrow(ErrorDerivaReloj);
  });

  it('acepta justo en el límite de deriva', () => {
    const reloj = relojFalso();
    const hlc = new RelojHlc('A', reloj.ahora);
    const alLimite = formatearHlc({
      fisico: reloj.ahora() + DERIVA_MAXIMA_MS,
      logico: 0,
      nodo: 'B',
    });
    expect(() => hlc.recibir(alLimite)).not.toThrow();
  });
});

describe('validación del nodo', () => {
  it('rechaza nodo vacío o con guiones', () => {
    // Un guión rompería parsearHlc() de forma silenciosa.
    expect(() => new RelojHlc('')).toThrow();
    expect(() => new RelojHlc('A-B')).toThrow();
  });
});

describe('guardas de desbordamiento', () => {
  // Estas guardas protegen algo que no es obvio: el formato tiene ANCHO FIJO
  // (4 dígitos hex para `logico`). Si el contador pasara de 0xffff sin
  // detenerse, formatearHlc() emitiría 5 dígitos y el orden lexicográfico
  // —la base de todo el sistema— se rompería en silencio.
  //
  // Es preferible un error ruidoso a un HLC que ordena mal.

  it('ahora() se detiene antes de romper el formato', () => {
    const reloj = relojFalso();
    const hlc = new RelojHlc('A', reloj.ahora); // reloj CONGELADO
    // 65536 llamadas caben (logico va de 0 a 0xffff)
    for (let i = 0; i <= 0xffff; i++) hlc.ahora();
    expect(hlc.estado().logico).toBe(0xffff);
    // La 65537 desborda
    expect(() => hlc.ahora()).toThrow(/[Dd]esbordamiento/);
  });

  it('el formato conserva el ancho fijo hasta el máximo', () => {
    const enElLimite = formatearHlc({ fisico: 1_700_000_000_000, logico: 0xffff, nodo: 'A' });
    const partes = enElLimite.split('-');
    expect(partes[1]).toHaveLength(4);
    expect(parsearHlc(enElLimite).logico).toBe(0xffff);
  });

  it('recibir() también se detiene', () => {
    const reloj = relojFalso();
    const hlc = new RelojHlc('A', reloj.ahora);
    // Un remoto con el contador al tope, mismo milisegundo
    const remoto = formatearHlc({ fisico: reloj.ahora(), logico: 0xffff, nodo: 'B' });
    expect(() => hlc.recibir(remoto)).toThrow(/[Dd]esbordamiento/);
  });
});

describe('propiedades (property-based)', () => {
  const arbHlc = fc
    .record({
      fisico: fc.integer({ min: 0, max: 2 ** 45 }),
      logico: fc.integer({ min: 0, max: 0xffff }),
      nodo: fc.constantFrom('A', 'B', 'C', 'D'),
    })
    .map(formatearHlc);

  it('compararHlc es un orden total', () => {
    fc.assert(
      fc.property(arbHlc, arbHlc, (a, b) => {
        const r = compararHlc(a, b);
        // Antisimetría: si a<b entonces b>a, y solo son iguales si son idénticos.
        if (a === b) return r === 0;
        return r !== 0 && Math.sign(r) === -Math.sign(compararHlc(b, a));
      }),
      { numRuns: 2000 },
    );
  });

  it('compararHlc es transitivo', () => {
    fc.assert(
      fc.property(arbHlc, arbHlc, arbHlc, (a, b, c) => {
        if (compararHlc(a, b) <= 0 && compararHlc(b, c) <= 0) {
          return compararHlc(a, c) <= 0;
        }
        return true;
      }),
      { numRuns: 2000 },
    );
  });

  it('ordenar es determinista sin importar el orden inicial', () => {
    // ESTA es la propiedad que sostiene RNF-I-6: cliente y servidor reciben
    // los mismos eventos en órdenes distintos y DEBEN converger al mismo
    // estado. Si el orden no fuera total y determinista, no convergerían.
    fc.assert(
      fc.property(fc.array(arbHlc, { minLength: 2, maxLength: 40 }), (hlcs) => {
        const a = [...hlcs].sort(compararHlc);
        const b = [...hlcs].reverse().sort(compararHlc);
        const c = [...hlcs].sort(() => Math.random() - 0.5).sort(compararHlc);
        return (
          JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(b) === JSON.stringify(c)
        );
      }),
      { numRuns: 500 },
    );
  });

  it('un reloj siempre genera HLC estrictamente crecientes', () => {
    fc.assert(
      fc.property(
        // Saltos de reloj arbitrarios, incluidos los NEGATIVOS (NTP)
        fc.array(fc.integer({ min: -10_000, max: 10_000 }), { minLength: 1, maxLength: 60 }),
        (saltos) => {
          const reloj = relojFalso();
          const hlc = new RelojHlc('A', reloj.ahora);
          let anterior = hlc.ahora();
          for (const salto of saltos) {
            reloj.avanzar(salto);
            const actual = hlc.ahora();
            if (compararHlc(anterior, actual) >= 0) return false;
            anterior = actual;
          }
          return true;
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('dos dispositivos que se sincronizan convergen al orden causal', () => {
    // Simula el ida y vuelta real: A genera, B recibe y genera, A recibe…
    // Cada evento debe ir después de todo lo que su autor ya conocía.
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { minLength: 2, maxLength: 40 }),
        fc.array(fc.integer({ min: -2_000, max: 2_000 }), { minLength: 2, maxLength: 40 }),
        (quienEmite, derivas) => {
          const relojA = relojFalso(1_700_000_000_000);
          const relojB = relojFalso(1_700_000_000_000);
          const a = new RelojHlc('A', relojA.ahora);
          const b = new RelojHlc('B', relojB.ahora);

          let ultimo: string | null = null;
          for (let i = 0; i < quienEmite.length; i++) {
            const emisor = quienEmite[i] ? a : b;
            const reloj = quienEmite[i] ? relojA : relojB;
            // Los relojes de las dos tablets se desvían entre sí.
            reloj.avanzar(derivas[i % derivas.length] ?? 0);

            let hlc: string;
            try {
              hlc = ultimo === null ? emisor.ahora() : emisor.recibir(ultimo);
            } catch (e) {
              // Deriva fuera de límite: es el comportamiento correcto.
              if (e instanceof ErrorDerivaReloj) return true;
              throw e;
            }
            if (ultimo !== null && compararHlc(ultimo, hlc) >= 0) return false;
            ultimo = hlc;
          }
          return true;
        },
      ),
      { numRuns: 1000 },
    );
  });
});
