// Lista de comandas (RF-E-12, RF-E-14, 4.8). Las ABIERTAS salen del log local
// (funcionan sin red); el HISTÓRICO cerrado se pide al servidor (RS-L-4).
// Tocar una abierta entra al modo adición (RF-E-7).
import { useEffect, useState } from 'react';
import { formatearMoneda } from '@lena/shared';
import type { Comanda } from '@lena/shared';
import { obtenerHistorial } from '../dominio/api';
import type { ComandaHistorial } from '../dominio/api';
import { comandasAbiertas } from '../dominio/comandas';
import { leerVoceo } from '../dominio/dispositivo';
import type { Motor } from '../dominio/motor';

interface Props {
  motor: Motor;
  token: string;
  onAgregar: (comandaId: string, etiqueta: string) => void;
  onVolver: () => void;
}

const NOMBRE_ESTADO: Record<string, string> = {
  borrador: 'Borrador',
  enviada: 'En cocina',
  en_preparacion: 'En cocina',
  lista: 'Lista',
  entregada: 'Entregada',
  cobrada: 'Cobrada',
  cancelada: 'Cancelada',
};

function etiquetaDe(c: Comanda): string {
  return leerVoceo(c.id) ?? (c.tipoServicio === 'mesa' ? 'Mesa' : 'Comanda');
}

export function Comandas({ motor, token, onAgregar, onVolver }: Props) {
  const [abiertas, setAbiertas] = useState<Comanda[]>([]);
  const [historial, setHistorial] = useState<ComandaHistorial[] | null>(null);

  useEffect(() => {
    motor.almacen.log().then((log) => setAbiertas(comandasAbiertas(log)));
    obtenerHistorial(token)
      .then(setHistorial)
      .catch(() => setHistorial([])); // sin red: solo abiertas
  }, [motor, token]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-piedra-200 px-4 py-3">
        <button type="button" onClick={onVolver} className="font-semibold text-piedra-600">
          ‹ Captura
        </button>
        <h2 className="text-h2 font-semibold">Comandas</h2>
        <span className="w-16" />
      </header>

      <div className="flex-1 overflow-y-auto">
        <h3 className="px-4 pt-3 text-label font-semibold uppercase text-piedra-500">Abiertas</h3>
        {abiertas.length === 0 && <p className="px-4 py-2 text-piedra-400">Ninguna abierta</p>}
        <ul>
          {abiertas.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onAgregar(c.id, etiquetaDe(c))}
                className="flex w-full items-center justify-between border-b border-piedra-100 px-4 py-3 text-left active:bg-piedra-100"
              >
                <span>
                  <span className="text-body-lg font-semibold text-brasa-700 tabular-nums">{etiquetaDe(c)}</span>
                  <span className="ml-2 text-sm text-piedra-500">{NOMBRE_ESTADO[c.estado] ?? c.estado}</span>
                </span>
                <span className="tabular-nums font-medium">{formatearMoneda(c.total)}</span>
              </button>
            </li>
          ))}
        </ul>

        <h3 className="px-4 pt-4 text-label font-semibold uppercase text-piedra-500">Historial</h3>
        {historial === null && <p className="px-4 py-2 text-piedra-400">Cargando…</p>}
        {historial?.length === 0 && <p className="px-4 py-2 text-piedra-400">Sin comandas cerradas</p>}
        <ul>
          {(historial ?? []).map((c) => (
            <li key={c.id} className="flex items-center justify-between border-b border-piedra-100 px-4 py-3">
              <span>
                <span className="font-semibold tabular-nums">{c.folio ? `#${c.folio}` : '—'}</span>
                <span className="ml-2 text-sm text-piedra-500">{NOMBRE_ESTADO[c.estado] ?? c.estado}</span>
              </span>
              <span className="tabular-nums font-medium">{formatearMoneda(c.total)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
