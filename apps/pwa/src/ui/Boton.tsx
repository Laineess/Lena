import type { ButtonHTMLAttributes } from 'react';

type Variante = 'primario' | 'suave' | 'peligro';

const CLASES: Record<Variante, string> = {
  primario: 'bg-rojo-600 text-white active:bg-rojo-500 disabled:bg-carbon-700 disabled:text-piedra-500',
  suave: 'bg-carbon-800 text-piedra-100 active:bg-carbon-700 disabled:text-piedra-500',
  peligro: 'bg-rojo-700 text-white active:opacity-90',
};

export function Boton({
  variante = 'primario',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante }) {
  return (
    <button
      {...props}
      className={`tactil rounded-md px-4 font-semibold transition-colors disabled:cursor-not-allowed ${CLASES[variante]} ${className}`}
    />
  );
}
