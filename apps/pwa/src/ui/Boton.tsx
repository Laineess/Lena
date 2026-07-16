import type { ButtonHTMLAttributes } from 'react';

type Variante = 'primario' | 'suave' | 'peligro';

const CLASES: Record<Variante, string> = {
  primario: 'bg-brasa-700 text-white active:bg-brasa-800 disabled:bg-piedra-300',
  suave: 'bg-piedra-100 text-piedra-900 active:bg-piedra-200 disabled:text-piedra-400',
  peligro: 'bg-error text-white active:opacity-90',
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
