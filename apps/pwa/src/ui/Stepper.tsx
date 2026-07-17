// Stepper de cantidad en línea (09 §4). El [+] es un toque; la cantidad se ve
// sin abrir nada (RNF-U-2). Botones de 56px (09 §2.6).
interface Props {
  cantidad: number;
  onCambio: (nueva: number) => void;
  disabled?: boolean;
}

export function Stepper({ cantidad, onCambio, disabled }: Props) {
  const boton = 'flex h-14 w-14 items-center justify-center rounded-md text-2xl font-bold disabled:opacity-40';
  return (
    <div className="flex items-center gap-2">
      {cantidad > 0 && (
        <>
          <button
            type="button"
            aria-label="quitar uno"
            disabled={disabled}
            onClick={() => onCambio(cantidad - 1)}
            className={`${boton} bg-carbon-800 text-piedra-100 active:bg-carbon-700`}
          >
            −
          </button>
          <span aria-label="cantidad" className="w-6 text-center text-xl font-semibold tabular-nums">
            {cantidad}
          </span>
        </>
      )}
      <button
        type="button"
        aria-label="agregar uno"
        disabled={disabled}
        onClick={() => onCambio(cantidad + 1)}
        className={`${boton} bg-rojo-600 text-white active:bg-rojo-500`}
      >
        +
      </button>
    </div>
  );
}
