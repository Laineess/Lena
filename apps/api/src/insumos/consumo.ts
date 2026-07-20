// Resumen de consumo derivado por insumo en un periodo (RF-L-7). Puro: suma el
// consumo y la merma de cada día (que la vista consumo_diario_insumo ya calculó
// como apertura + comprado − cierre) por insumo. Testeable sin base.
export interface FilaConsumo {
  insumoId: string;
  nombre: string;
  unidad: string;
  consumo: number;
  mermaReportada: number;
}

export interface ResumenInsumo {
  insumoId: string;
  nombre: string;
  unidad: string;
  consumo: number;
  merma: number;
  dias: number;
}

export function resumirConsumo(filas: FilaConsumo[]): ResumenInsumo[] {
  const m = new Map<string, ResumenInsumo>();
  for (const f of filas) {
    const r =
      m.get(f.insumoId) ??
      { insumoId: f.insumoId, nombre: f.nombre, unidad: f.unidad, consumo: 0, merma: 0, dias: 0 };
    r.consumo += f.consumo;
    r.merma += f.mermaReportada;
    r.dias += 1;
    m.set(f.insumoId, r);
  }
  // Mayor consumo primero: lo que más se gasta es lo que más importa comprar.
  return [...m.values()].sort((a, b) => b.consumo - a.consumo);
}
