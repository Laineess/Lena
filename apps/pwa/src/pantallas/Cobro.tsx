// Cobro del mesero (09 §5). Solo tras entregar (RF-E-23). Métodos, efectivo con
// atajos y cambio, pago dividido (RF-G-3). COBRAR se habilita solo cuando
// pagos = total (RF-G-6). El servidor revalida (RNF-I-2).
import { useMemo, useState } from 'react';
import { formatearMoneda } from '@lena/shared';
import type { Comanda, MetodoPago } from '@lena/shared';
import { Boton } from '../ui/Boton';
import { rolEvento } from '../dominio/api';
import type { DatosSesion } from '../dominio/api';
import { hlcMaximo } from '../dominio/cocina';
import { configDispositivo } from '../dominio/dispositivo';
import { ConstructorEventos } from '../dominio/eventos';
import type { Motor } from '../dominio/motor';

interface Pago {
  metodo: MetodoPago;
  monto: number;
  recibido?: number;
}

interface Props {
  sesion: DatosSesion;
  comanda: Comanda;
  motor: Motor;
  onListo: () => void;
}

const ATAJOS = [10000, 20000, 50000]; // $100, $200, $500 en centavos (09 §5)

export function Cobro({ sesion, comanda, motor, onListo }: Props) {
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

  const [pagos, setPagos] = useState<Pago[]>([]);
  const [metodo, setMetodo] = useState<MetodoPago>('efectivo');
  const [recibido, setRecibido] = useState<number | null>(null);
  const [cobrando, setCobrando] = useState(false);

  const total = comanda.total;
  const pagado = pagos.reduce((a, p) => a + p.monto, 0);
  const falta = total - pagado;
  const cambio = metodo === 'efectivo' && recibido !== null ? Math.max(0, recibido - falta) : 0;

  function agregarPago() {
    if (falta <= 0) return;
    const monto = falta; // este pago cubre lo que falta (o parte si se edita)
    setPagos((p) => [...p, { metodo, monto, ...(metodo === 'efectivo' && recibido !== null ? { recibido } : {}) }]);
    setRecibido(null);
  }

  async function cobrar() {
    if (pagado !== total || cobrando) return;
    setCobrando(true);
    try {
      constructor.observar(hlcMaximo(await motor.almacen.log(), comanda.id));
      const eventos = [];
      // Entregar si aún no lo está (RF-E-22): el cobro lo exige.
      if (comanda.estado !== 'entregada') eventos.push(constructor.marcarEntregada(comanda.id));
      for (const p of pagos) eventos.push(constructor.registrarPago(comanda.id, p));
      eventos.push(constructor.cobrar(comanda.id));
      for (const e of eventos) await motor.sync.crear(e);
      onListo();
    } finally {
      setCobrando(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-carbon-700 px-4 py-3">
        <button type="button" onClick={onListo} className="font-semibold text-piedra-300">
          ‹ Cobrar
        </button>
        <span className="text-piedra-400">
          {comanda.tipoServicio === 'mesa'
            ? 'Mesa'
            : comanda.tipoServicio === 'domicilio'
              ? 'Domicilio'
              : 'Para llevar'}
        </span>
      </header>

      <ul className="border-b border-carbon-700 px-4 py-2">
        {comanda.lineas
          .filter((l) => l.estado !== 'cancelada')
          .map((l) => (
            <li key={l.id} className="flex justify-between py-1">
              <span>
                {l.cantidad}× {l.nombreProducto}
              </span>
              <span className="tabular-nums">{formatearMoneda(l.precioUnitario * l.cantidad)}</span>
            </li>
          ))}
      </ul>

      <div className="flex items-center justify-between border-b border-carbon-700 px-4 py-2 text-2xl font-bold">
        <span>TOTAL</span>
        <span className="tabular-nums">{formatearMoneda(total)}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {/* Pagos ya agregados (pago dividido) */}
        {pagos.map((p, i) => (
          <div key={i} className="mb-1 flex justify-between text-piedra-300">
            <span className="capitalize">{p.metodo}</span>
            <span className="tabular-nums">{formatearMoneda(p.monto)}</span>
          </div>
        ))}

        {falta > 0 && (
          <>
            <div className="my-3 grid grid-cols-3 gap-2">
              {(['efectivo', 'tarjeta', 'transferencia'] as MetodoPago[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMetodo(m)}
                  className={`tactil rounded-md py-3 text-sm font-semibold capitalize ${
                    metodo === m ? 'bg-carbon-800 text-oro-300' : 'bg-carbon-800 text-piedra-300'
                  }`}
                >
                  {m === 'efectivo' ? '💵' : m === 'tarjeta' ? '💳' : '📱'} {m}
                </button>
              ))}
            </div>

            {metodo === 'efectivo' && (
              <div className="mb-3">
                <label className="text-label text-piedra-300">Efectivo recibido</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    inputMode="numeric"
                    value={recibido !== null ? recibido / 100 : ''}
                    onChange={(e) => setRecibido(e.target.value ? Math.round(Number(e.target.value) * 100) : null)}
                    className="w-32 rounded-md border border-carbon-600 px-3 py-2 text-lg tabular-nums"
                    placeholder="$"
                  />
                  {ATAJOS.map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setRecibido(a)}
                      className="tactil rounded-md bg-carbon-800 px-3 font-semibold tabular-nums"
                    >
                      {formatearMoneda(a)}
                    </button>
                  ))}
                </div>
                {recibido !== null && (
                  <div className="mt-2 flex justify-between text-2xl font-bold text-ok">
                    <span>CAMBIO</span>
                    <span className="tabular-nums">{formatearMoneda(cambio)}</span>
                  </div>
                )}
              </div>
            )}

            <Boton
              variante="suave"
              onClick={agregarPago}
              disabled={metodo === 'efectivo' && (recibido === null || recibido < falta)}
              className="h-12 w-full"
            >
              Agregar {formatearMoneda(falta)} · {metodo}
            </Boton>
          </>
        )}
      </div>

      <footer className="border-t border-carbon-700 p-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-piedra-400">
            Pagado {formatearMoneda(pagado)} de {formatearMoneda(total)}
          </span>
          {pagado === total ? (
            <span className="font-semibold text-ok">✓ Completo</span>
          ) : (
            <span className="font-semibold text-atencion">Falta {formatearMoneda(falta)}</span>
          )}
        </div>
        <Boton onClick={cobrar} disabled={pagado !== total || cobrando} className="h-16 w-full text-lg">
          {cobrando ? 'Cobrando…' : 'COBRAR ✓'}
        </Boton>
      </footer>
    </div>
  );
}
