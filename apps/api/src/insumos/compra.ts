// Fase 2 · parte B — Motor de compra sugerida (RF-M). Lógica pura y testeable;
// las consultas (regr_slope, ventas por día) viven en las rutas.
//
// Pipeline: pronóstico de venta por día de la semana (RF-M-2) → ratio
// insumo↔venta aprendido con regr_slope (RF-M-1) → recomendación (RF-M-3),
// sumando la merma de producto por cancelación (RF-M-7) y avisando cuando el
// historial es pobre (RF-M-6). Sin recetas (ADR §7).

export type Confianza = 'alta' | 'media' | 'insuficiente';

// RF-M-2: suma el pronóstico (media móvil por día de la semana) de los próximos
// `dias` a partir de `inicioISO`. promPorDow: unidades promedio por día 0..6.
export function pronosticoHorizonte(promPorDow: Record<number, number>, inicioISO: string, dias: number): number {
  let total = 0;
  const base = new Date(`${inicioISO}T12:00:00Z`);
  for (let i = 0; i < dias; i++) {
    const d = new Date(base.getTime() + i * 86_400_000);
    total += promPorDow[d.getUTCDay()] ?? 0;
  }
  return total;
}

export function confianzaPorDias(dias: number): Confianza {
  if (dias >= 28) return 'alta';
  if (dias >= 14) return 'media';
  return 'insuficiente';
}

export interface EntradaRecomendacion {
  ratio: number | null; // insumo por unidad vendida (regr_slope, RF-M-1)
  previstoUnidades: number; // unidades pronosticadas en el horizonte (RF-M-2)
  mermaUnidades: number; // unidades de merma de producto en el horizonte (RF-M-7)
  stockActual: number; // último conteo del insumo
  stockSeguridad: number; // RF-M-4
  dias: number; // días de historial con datos (para la confianza, RF-M-6)
}

export interface Recomendacion {
  consumoPrevisto: number;
  recomendado: number | null; // null = no hay datos para recomendar (RF-M-6)
  confianza: Confianza;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function recomendarCompra(e: EntradaRecomendacion): Recomendacion {
  const confianza = confianzaPorDias(e.dias);
  // RF-M-6: no se recomienda sobre datos pobres ni sin correlación; se avisa.
  if (confianza === 'insuficiente' || e.ratio === null || e.ratio <= 0) {
    return { consumoPrevisto: 0, recomendado: null, confianza: 'insuficiente' };
  }
  // RF-M-7: la merma de producto también consumió insumo; se suma a la demanda.
  const consumoPrevisto = (e.previstoUnidades + e.mermaUnidades) * e.ratio;
  // RF-M-3: comprar lo que falta para cubrir el consumo previsto + colchón.
  const recomendado = Math.max(0, consumoPrevisto + e.stockSeguridad - e.stockActual);
  return { consumoPrevisto: r3(consumoPrevisto), recomendado: r3(recomendado), confianza };
}
