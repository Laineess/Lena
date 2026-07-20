import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Stepper } from './Stepper';

describe('Stepper', () => {
  it('en 0 solo muestra el [+] y suma al tocarlo', () => {
    const onCambio = vi.fn();
    render(<Stepper cantidad={0} onCambio={onCambio} />);
    expect(screen.queryByLabelText('quitar uno')).toBeNull();
    screen.getByLabelText('agregar uno').click();
    expect(onCambio).toHaveBeenCalledWith(1);
  });

  it('con cantidad > 0 muestra el número y resta con [−]', () => {
    const onCambio = vi.fn();
    render(<Stepper cantidad={2} onCambio={onCambio} />);
    expect(screen.getByLabelText('cantidad').textContent).toBe('2');
    screen.getByLabelText('quitar uno').click();
    expect(onCambio).toHaveBeenCalledWith(1);
  });
});
