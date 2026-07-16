import { describe, expect, it } from 'vitest';
import { BASE_MS, TOPE_MS, calcularEspera } from './backoff';

describe('calcularEspera', () => {
  it('nunca pasa del tope, aun con jitter al máximo', () => {
    for (let intento = 0; intento < 20; intento++) {
      expect(calcularEspera(intento, () => 1)).toBeLessThanOrEqual(TOPE_MS);
    }
  });

  it('crece con el intento (con jitter fijo)', () => {
    const sinJitter = (i: number) => calcularEspera(i, () => 1);
    expect(sinJitter(0)).toBe(BASE_MS);
    expect(sinJitter(1)).toBe(2 * BASE_MS);
    expect(sinJitter(2)).toBe(4 * BASE_MS);
  });

  it('el jitter reparte entre 0 y el valor exponencial', () => {
    expect(calcularEspera(3, () => 0)).toBe(0);
    expect(calcularEspera(3, () => 0.5)).toBe(4 * BASE_MS); // 8000 * 0.5
  });

  it('un intento negativo no rompe', () => {
    expect(calcularEspera(-5, () => 1)).toBe(BASE_MS);
  });
});
