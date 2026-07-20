import { describe, expect, it } from 'vitest';
import { confianzaPorDias, pronosticoHorizonte, recomendarCompra } from './compra';

describe('pronosticoHorizonte', () => {
  it('suma el promedio del día de la semana de cada día del horizonte', () => {
    // 2026-07-17 es viernes (dow 5). prom: vie=100, sáb=200, dom=50.
    const prom = { 5: 100, 6: 200, 0: 50 };
    // 3 días desde el viernes: vie + sáb + dom = 350.
    expect(pronosticoHorizonte(prom, '2026-07-17', 3)).toBe(350);
  });

  it('días sin promedio cuentan 0', () => {
    expect(pronosticoHorizonte({ 5: 100 }, '2026-07-17', 2)).toBe(100); // vie 100 + sáb 0
  });
});

describe('confianzaPorDias', () => {
  it('escalona por semanas de datos', () => {
    expect(confianzaPorDias(30)).toBe('alta');
    expect(confianzaPorDias(20)).toBe('media');
    expect(confianzaPorDias(10)).toBe('insuficiente');
  });
});

describe('recomendarCompra', () => {
  const base = { ratio: 0.1, previstoUnidades: 100, mermaUnidades: 0, stockActual: 2, stockSeguridad: 1, dias: 30 };

  it('recomienda consumo_previsto + seguridad − stock (RF-M-3)', () => {
    // consumo = 100 × 0.1 = 10; recomendado = 10 + 1 − 2 = 9.
    expect(recomendarCompra(base)).toMatchObject({ consumoPrevisto: 10, recomendado: 9, confianza: 'alta' });
  });

  it('nunca recomienda negativo (hay stock de sobra)', () => {
    expect(recomendarCompra({ ...base, stockActual: 100 }).recomendado).toBe(0);
  });

  it('suma la merma de producto a la demanda (RF-M-7)', () => {
    // (100 + 50) × 0.1 = 15; recomendado = 15 + 1 − 2 = 14.
    expect(recomendarCompra({ ...base, mermaUnidades: 50 }).recomendado).toBe(14);
  });

  it('con historial pobre no recomienda, avisa (RF-M-6)', () => {
    expect(recomendarCompra({ ...base, dias: 5 })).toMatchObject({ recomendado: null, confianza: 'insuficiente' });
  });

  it('sin correlación (ratio null) no recomienda', () => {
    expect(recomendarCompra({ ...base, ratio: null }).recomendado).toBeNull();
  });
});
