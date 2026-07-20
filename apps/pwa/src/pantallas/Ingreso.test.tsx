import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Ingreso } from './Ingreso';

afterEach(() => localStorage.clear());

describe('Ingreso', () => {
  it('sin sucursal recordada, arranca en el paso de la clave', () => {
    render(<Ingreso onIngreso={vi.fn()} />);
    expect(screen.getByPlaceholderText('CLAVE')).toBeInTheDocument();
    expect(screen.getByText('Continuar')).toBeInTheDocument();
    expect(screen.getByText('Soy dueño o administrador')).toBeInTheDocument();
  });

  it('el botón de acceso de gestión cambia a correo/contraseña', () => {
    render(<Ingreso onIngreso={vi.fn()} />);
    fireEvent.click(screen.getByText('Soy dueño o administrador'));
    expect(screen.getByPlaceholderText('Correo')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Contraseña')).toBeInTheDocument();
  });
});
