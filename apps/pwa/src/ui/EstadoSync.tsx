// Indicador de sincronización (D3, RF-E-14). Nunca solo color: icono + texto
// (09 §2.3). Verde en línea, ámbar con pendientes, rojo sin red.
interface Props {
  enLinea: boolean;
  pendientes: number;
}

export function EstadoSync({ enLinea, pendientes }: Props) {
  if (!enLinea) {
    return (
      <span className="flex items-center gap-1 text-sm font-medium text-error">
        <span aria-hidden>⚠</span> Sin red{pendientes > 0 ? ` · ${pendientes}` : ''}
      </span>
    );
  }
  if (pendientes > 0) {
    return (
      <span className="flex items-center gap-1 text-sm font-medium text-atencion">
        <span aria-hidden>↑</span> Enviando {pendientes}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-sm font-medium text-ok">
      <span aria-hidden>●</span> En línea
    </span>
  );
}
