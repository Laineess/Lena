import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EstadoSync } from './EstadoSync';

describe('EstadoSync', () => {
  it('muestra "Sin red" cuando no hay línea (nunca solo color, 09 §2.3)', () => {
    render(<EstadoSync enLinea={false} pendientes={3} />);
    expect(screen.getByText(/Sin red/)).toBeInTheDocument();
    expect(screen.getByText(/3/)).toBeInTheDocument();
  });

  it('muestra "Enviando" con pendientes en línea', () => {
    render(<EstadoSync enLinea pendientes={2} />);
    expect(screen.getByText(/Enviando 2/)).toBeInTheDocument();
  });

  it('muestra "En línea" sin pendientes', () => {
    render(<EstadoSync enLinea pendientes={0} />);
    expect(screen.getByText(/En línea/)).toBeInTheDocument();
  });
});
