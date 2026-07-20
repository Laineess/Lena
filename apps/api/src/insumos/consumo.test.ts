import { describe, expect, it } from 'vitest';
import { resumirConsumo } from './consumo';

describe('resumirConsumo', () => {
  it('suma consumo y merma por insumo y cuenta los días', () => {
    const r = resumirConsumo([
      { insumoId: 'a', nombre: 'Carne', unidad: 'kg', consumo: 10, mermaReportada: 1 },
      { insumoId: 'a', nombre: 'Carne', unidad: 'kg', consumo: 12, mermaReportada: 0 },
      { insumoId: 'b', nombre: 'Tortilla', unidad: 'kg', consumo: 5, mermaReportada: 2 },
    ]);
    const carne = r.find((x) => x.insumoId === 'a');
    expect(carne).toMatchObject({ consumo: 22, merma: 1, dias: 2 });
    const tortilla = r.find((x) => x.insumoId === 'b');
    expect(tortilla).toMatchObject({ consumo: 5, merma: 2, dias: 1 });
  });

  it('ordena por mayor consumo', () => {
    const r = resumirConsumo([
      { insumoId: 'a', nombre: 'Poco', unidad: 'kg', consumo: 3, mermaReportada: 0 },
      { insumoId: 'b', nombre: 'Mucho', unidad: 'kg', consumo: 30, mermaReportada: 0 },
    ]);
    expect(r[0]?.insumoId).toBe('b');
  });

  it('lista vacía → arreglo vacío', () => {
    expect(resumirConsumo([])).toEqual([]);
  });
});
