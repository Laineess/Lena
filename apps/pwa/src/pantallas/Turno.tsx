// Turno de caja (RF-H). Abrir con fondo inicial; cerrar mostrando esperado,
// contado y diferencia. El servidor bloquea el cierre si hay comandas abiertas.
import { useEffect, useState } from 'react';
import { formatearMoneda } from '@lena/shared';
import { Boton } from '../ui/Boton';
import { abrirTurno, cerrarTurno, turnoActual } from '../dominio/api';
import type { CierreTurno, TurnoActual } from '../dominio/api';

interface Props {
  token: string;
  onVolver: () => void;
}

export function Turno({ token, onVolver }: Props) {
  const [turno, setTurno] = useState<TurnoActual | null | undefined>(undefined);
  const [fondo, setFondo] = useState('');
  const [contado, setContado] = useState('');
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [abiertas, setAbiertas] = useState<number | null>(null);
  const [cierre, setCierre] = useState<CierreTurno | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    turnoActual(token)
      .then(setTurno)
      .catch(() => setTurno(null));
  }, [token]);

  async function abrir() {
    setOcupado(true);
    setError(null);
    try {
      await abrirTurno(token, Math.round(Number(fondo) * 100));
      setTurno(await turnoActual(token));
    } catch {
      setError('No se pudo abrir el turno');
    } finally {
      setOcupado(false);
    }
  }

  async function cerrar() {
    setOcupado(true);
    setError(null);
    setAbiertas(null);
    const r = await cerrarTurno(token, Math.round(Number(contado) * 100), motivo || undefined);
    setOcupado(false);
    if (r.ok) {
      setCierre(r.cierre);
      setTurno(null);
    } else if (r.error === 'comandas_abiertas') {
      setAbiertas(r.comandas?.length ?? 0);
    } else if (r.error === 'motivo_requerido') {
      setError('La diferencia es grande: escribe un motivo');
    } else {
      setError('No se pudo cerrar el turno');
    }
  }

  return (
    <div className="flex h-full flex-col p-4">
      <button type="button" onClick={onVolver} className="mb-4 self-start text-piedra-500">
        ‹ Volver
      </button>
      <h2 className="mb-4 text-h2 font-semibold">Turno de caja</h2>

      {turno === undefined && <p className="text-piedra-500">Cargando…</p>}

      {/* Resultado de un cierre */}
      {cierre && (
        <div className="rounded-lg border border-piedra-200 p-4">
          <p className="mb-2 font-semibold">Turno cerrado</p>
          <Renglon k="Esperado en efectivo" v={cierre.esperado} />
          <Renglon k="Contado" v={cierre.contado} />
          <Renglon k="Diferencia" v={cierre.diferencia} destaca />
          <hr className="my-2 border-piedra-200" />
          <Renglon k="Efectivo" v={cierre.desglose.efectivo} />
          <Renglon k="Tarjeta" v={cierre.desglose.tarjeta} />
          <Renglon k="Transferencia" v={cierre.desglose.transferencia} />
        </div>
      )}

      {/* Abrir */}
      {turno === null && !cierre && (
        <div className="flex flex-col gap-3">
          <label className="text-label text-piedra-600">Fondo inicial</label>
          <input
            type="number"
            inputMode="numeric"
            value={fondo}
            onChange={(e) => setFondo(e.target.value)}
            className="rounded-md border border-piedra-300 px-3 py-3 text-lg tabular-nums"
            placeholder="$"
          />
          <Boton onClick={abrir} disabled={ocupado || !fondo} className="h-14">
            Abrir turno
          </Boton>
        </div>
      )}

      {/* Cerrar */}
      {turno && (
        <div className="flex flex-col gap-3">
          <p className="text-piedra-500">Turno abierto · fondo {formatearMoneda(turno.fondoInicial)}</p>
          <label className="text-label text-piedra-600">Efectivo contado</label>
          <input
            type="number"
            inputMode="numeric"
            value={contado}
            onChange={(e) => setContado(e.target.value)}
            className="rounded-md border border-piedra-300 px-3 py-3 text-lg tabular-nums"
            placeholder="$"
          />
          <label className="text-label text-piedra-600">Motivo (si hay diferencia)</label>
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            className="rounded-md border border-piedra-300 px-3 py-2"
          />
          {abiertas !== null && (
            <p className="text-error">Hay {abiertas} comanda(s) abierta(s). Resuélvelas antes de cerrar (RF-H-8).</p>
          )}
          <Boton variante="peligro" onClick={cerrar} disabled={ocupado || !contado} className="h-14">
            Cerrar turno
          </Boton>
        </div>
      )}

      {error && <p className="mt-3 text-error">{error}</p>}
    </div>
  );
}

function Renglon({ k, v, destaca }: { k: string; v: number; destaca?: boolean }) {
  return (
    <div className={`flex justify-between py-0.5 ${destaca ? 'text-lg font-bold' : ''}`}>
      <span className="text-piedra-600">{k}</span>
      <span className="tabular-nums">{formatearMoneda(v)}</span>
    </div>
  );
}
