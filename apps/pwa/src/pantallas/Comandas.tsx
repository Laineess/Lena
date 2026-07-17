// Lista de comandas (RF-E-12, RF-E-14, 4.8). Abiertas del log local (offline);
// histórico cerrado del servidor (RS-L-4). Por comanda: cobrar, agregar (RF-E-7)
// y cancelar con la advertencia de merma obligatoria (RF-E-18).
import { useEffect, useMemo, useState } from 'react';
import { calcularMermaSiSeCancela, formatearMoneda } from '@lena/shared';
import type { Comanda } from '@lena/shared';
import { Boton } from '../ui/Boton';
import { obtenerHistorial, rolEvento } from '../dominio/api';
import type { ComandaHistorial, DatosSesion } from '../dominio/api';
import { comandasAbiertas } from '../dominio/comandas';
import { hlcMaximo } from '../dominio/cocina';
import { configDispositivo, leerVoceo } from '../dominio/dispositivo';
import { ConstructorEventos } from '../dominio/eventos';
import type { Motor } from '../dominio/motor';

interface Props {
  sesion: DatosSesion;
  motor: Motor;
  token: string;
  onCobrar: (comanda: Comanda) => void;
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

export function Comandas({ sesion, motor, token, onCobrar, onAgregar, onVolver }: Props) {
  const disp = configDispositivo();
  const constructor = useMemo(
    () =>
      new ConstructorEventos({
        sucursalId: sesion.sesion.sucursalId as string,
        actorId: sesion.sesion.usuarioId,
        dispositivoId: sesion.sesion.dispositivoId as string,
        nodo: disp.letra,
        rol: rolEvento(sesion.sesion.rol),
      }),
    [sesion, disp.letra],
  );

  const [abiertas, setAbiertas] = useState<Comanda[]>([]);
  const [historial, setHistorial] = useState<ComandaHistorial[] | null>(null);
  const [cancelar, setCancelar] = useState<Comanda | null>(null);
  const [motivo, setMotivo] = useState('');

  async function recargar() {
    setAbiertas(comandasAbiertas(await motor.almacen.log()));
  }

  useEffect(() => {
    void recargar();
    obtenerHistorial(token)
      .then(setHistorial)
      .catch(() => setHistorial([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function confirmarCancelacion() {
    if (!cancelar || !motivo.trim()) return;
    constructor.observar(hlcMaximo(await motor.almacen.log(), cancelar.id));
    await motor.sync.crear(constructor.cancelarComanda(cancelar.id, motivo.trim()));
    setCancelar(null);
    setMotivo('');
    await recargar();
  }

  // Diálogo de cancelación con advertencia de merma (RF-E-18).
  if (cancelar) {
    const merma = calcularMermaSiSeCancela(cancelar, rolEvento(sesion.sesion.rol));
    return (
      <div className="flex h-full flex-col p-4">
        <h2 className="mb-3 text-h2 font-semibold">⚠️ Cancelar {etiquetaDe(cancelar)}</h2>
        {merma.lineas.length > 0 ? (
          <>
            <p className="mb-2 text-piedra-300">Estos platillos YA ESTÁN EN COCINA:</p>
            <ul className="mb-3">
              {merma.lineas.map((l) => (
                <li key={l.detalleId} className="flex justify-between py-1">
                  <span>
                    {l.cantidad}× {l.nombreProducto}
                  </span>
                  <span className="tabular-nums">{formatearMoneda(l.costo)}</span>
                </li>
              ))}
            </ul>
            <div className="mb-4 rounded-lg bg-[#FEE2E2] p-3 text-center">
              <p className="text-error">Se registrarán como merma</p>
              <p className="text-[32px] font-bold text-error tabular-nums">{formatearMoneda(merma.costoTotal)}</p>
            </div>
          </>
        ) : (
          <p className="mb-4 text-piedra-300">Nada se envió a cocina; no hay merma.</p>
        )}
        <label className="text-label text-piedra-300">Motivo *</label>
        <input
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          className="mb-4 rounded-md border border-carbon-600 px-3 py-2"
          autoFocus
        />
        <div className="mt-auto flex gap-3">
          <Boton
            className="h-14 flex-1"
            onClick={() => {
              setCancelar(null);
              setMotivo('');
            }}
          >
            NO, VOLVER
          </Boton>
          <Boton
            variante="peligro"
            className="h-14 flex-1"
            disabled={!motivo.trim()}
            onClick={() => void confirmarCancelacion()}
          >
            SÍ, CANCELAR
          </Boton>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-carbon-700 px-4 py-3">
        <button type="button" onClick={onVolver} className="font-semibold text-piedra-300">
          ‹ Captura
        </button>
        <h2 className="text-h2 font-semibold">Comandas</h2>
        <span className="w-16" />
      </header>

      <div className="flex-1 overflow-y-auto">
        <h3 className="px-4 pt-3 text-label font-semibold uppercase text-piedra-400">Abiertas</h3>
        {abiertas.length === 0 && <p className="px-4 py-2 text-piedra-400">Ninguna abierta</p>}
        <ul>
          {abiertas.map((c) => {
            const cobrable = c.estado === 'lista' || c.estado === 'entregada';
            return (
              <li key={c.id} className="border-b border-carbon-800 px-4 py-3">
                <div className="flex items-center justify-between">
                  <span>
                    <span className="text-body-lg font-semibold text-oro-400 tabular-nums">{etiquetaDe(c)}</span>
                    <span className="ml-2 text-sm text-piedra-400">{NOMBRE_ESTADO[c.estado] ?? c.estado}</span>
                  </span>
                  <span className="font-medium tabular-nums">{formatearMoneda(c.total)}</span>
                </div>
                <div className="mt-2 flex gap-2">
                  <Boton className="h-11 flex-1 text-sm" disabled={!cobrable} onClick={() => onCobrar(c)}>
                    Cobrar
                  </Boton>
                  <Boton
                    variante="suave"
                    className="h-11 flex-1 text-sm"
                    onClick={() => onAgregar(c.id, etiquetaDe(c))}
                  >
                    + Agregar
                  </Boton>
                  <Boton variante="suave" className="h-11 text-sm" onClick={() => setCancelar(c)}>
                    Cancelar
                  </Boton>
                </div>
              </li>
            );
          })}
        </ul>

        <h3 className="px-4 pt-4 text-label font-semibold uppercase text-piedra-400">Historial</h3>
        {historial === null && <p className="px-4 py-2 text-piedra-400">Cargando…</p>}
        {historial?.length === 0 && <p className="px-4 py-2 text-piedra-400">Sin comandas cerradas</p>}
        <ul>
          {(historial ?? []).map((c) => (
            <li key={c.id} className="flex items-center justify-between border-b border-carbon-800 px-4 py-3">
              <span>
                <span className="font-semibold tabular-nums">{c.folio ? `#${c.folio}` : '—'}</span>
                <span className="ml-2 text-sm text-piedra-400">{NOMBRE_ESTADO[c.estado] ?? c.estado}</span>
              </span>
              <span className="font-medium tabular-nums">{formatearMoneda(c.total)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
