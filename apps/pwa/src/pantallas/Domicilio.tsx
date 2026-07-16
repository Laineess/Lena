// Captura de domicilio (09 §4.1, RF-E-17). El teléfono va primero: es la llave
// de búsqueda del cliente frecuente. Teléfono y dirección obligatorios. El
// enlace al aviso de privacidad es obligatorio (RS-P-3, LFPDPPP).
import { useState } from 'react';
import type { Domicilio as DatosDomicilio } from '@lena/shared';
import { Boton } from '../ui/Boton';

interface Props {
  onListo: (d: DatosDomicilio) => void;
  onCancelar: () => void;
}

export function Domicilio({ onListo, onCancelar }: Props) {
  const [telefono, setTelefono] = useState('');
  const [nombre, setNombre] = useState('');
  const [direccion, setDireccion] = useState('');
  const [referencias, setReferencias] = useState('');

  const valido = telefono.trim().length >= 7 && direccion.trim().length > 0 && nombre.trim().length > 0;

  const campo = 'w-full rounded-md border border-piedra-300 bg-white px-3 py-3 text-body-lg';
  const etiqueta = 'text-label font-medium text-piedra-600';

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={onCancelar} className="text-piedra-500">
          ‹ Cancelar
        </button>
        <h2 className="text-h2 font-semibold">Comanda a domicilio</h2>
        <span className="w-16" />
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
        <label className={etiqueta}>
          Teléfono *
          <input
            className={campo}
            inputMode="numeric"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            placeholder="771 123 4567"
            autoFocus
          />
        </label>
        <label className={etiqueta}>
          Nombre *
          <input className={campo} value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </label>
        <label className={etiqueta}>
          Dirección *
          <input className={campo} value={direccion} onChange={(e) => setDireccion(e.target.value)} />
        </label>
        <label className={etiqueta}>
          Referencias
          <input className={campo} value={referencias} onChange={(e) => setReferencias(e.target.value)} />
        </label>

        {/* RS-P-3: el aviso de privacidad se enlaza donde se recolecta el dato. */}
        <a href="/aviso-privacidad.html" target="_blank" rel="noreferrer" className="text-sm text-info underline">
          🔒 Aviso de privacidad
        </a>
      </div>

      <Boton
        onClick={() =>
          onListo({
            nombreCliente: nombre.trim(),
            telefono: telefono.trim(),
            direccion: direccion.trim(),
            ...(referencias.trim() ? { referencias: referencias.trim() } : {}),
          })
        }
        disabled={!valido}
        className="mt-3 h-14 w-full"
      >
        CONTINUAR →
      </Boton>
    </div>
  );
}
