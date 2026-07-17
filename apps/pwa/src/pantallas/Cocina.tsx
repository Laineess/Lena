// Vista de cocina (09 §6). Tema oscuro, tarjetas grandes, cronómetro con color
// por tiempo, botón ✓, comandas que regresan (tachado/destacado) y alertas de
// cancelación. Suena distinto según el evento (09 §6.5).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Comanda } from '@lena/shared';
import { configDispositivo } from '../dominio/dispositivo';
import { ConstructorEventos } from '../dominio/eventos';
import {
  COLOR_TIER,
  comandasCanceladas,
  comandasEnCocina,
  hlcMaximo,
  inicioEspera,
  lineasPendientes,
  lineasServidas,
  mmss,
  tierPorMinutos,
} from '../dominio/cocina';
import { desbloquearAudio, fijarVolumen, obtenerVolumen, reproducir } from '../dominio/sonido';
import { marcarDisponibilidad } from '../dominio/api';
import type { Catalogo, DatosSesion } from '../dominio/api';
import type { Motor } from '../dominio/motor';

const MAX_LINEAS_VISIBLES = 3; // (09 §6.0): 3 + "+N más"

interface Props {
  sesion: DatosSesion;
  catalogo: Catalogo;
  motor: Motor;
  enLinea: boolean;
  onSincronizar: () => void;
  onSalir: () => void;
}

interface Cancelada {
  comanda: Comanda;
  canceladaEn: number;
  motivo: string;
}

export function Cocina({ sesion, catalogo, motor, enLinea, onSincronizar, onSalir }: Props) {
  const disp = configDispositivo();
  const mesas = useMemo(() => new Map(catalogo.mesas.map((m) => [m.id, m.nombre])), [catalogo.mesas]);
  // Cocina no tiene folio (lo asigna el servidor, no viaja en el log) ni el
  // A-7 del mesero (es de otro dispositivo). Se identifica por mesa o tipo.
  const etiquetaDe = (c: Comanda): string =>
    c.tipoServicio === 'mesa'
      ? (c.mesaId && mesas.get(c.mesaId)) || 'Mesa'
      : c.tipoServicio === 'domicilio'
        ? '🏠 Domicilio'
        : 'Para llevar';
  const constructor = useMemo(
    () =>
      new ConstructorEventos({
        sucursalId: sesion.sesion.sucursalId as string,
        actorId: sesion.sesion.usuarioId,
        dispositivoId: sesion.sesion.dispositivoId as string,
        nodo: disp.letra,
        rol: 'cocina',
      }),
    [sesion, disp.letra],
  );

  const [comandas, setComandas] = useState<Comanda[]>([]);
  const [canceladas, setCanceladas] = useState<Cancelada[]>([]);
  const [reconocidas, setReconocidas] = useState<Set<string>>(new Set());
  const [ahora, setAhora] = useState(Date.now());
  const [menu, setMenu] = useState<string | null>(null);
  const [volumen, setVolumen] = useState(obtenerVolumen());
  const [ajustes, setAjustes] = useState(false);

  // Estado anterior para decidir qué sonido va (nueva / regresa / cancela / tic).
  const pendientesPrev = useRef<Map<string, number>>(new Map());
  const canceladasPrev = useRef<Set<string>>(new Set());
  const tierPrev = useRef<Map<string, string>>(new Map());
  const arranque = useRef(true);

  async function recargar() {
    const log = await motor.almacen.log();
    const enCocina = comandasEnCocina(log);
    const cancel = comandasCanceladas(log);

    // Sonidos, comparando contra el estado anterior (nunca en el primer render).
    const ahoraMs = Date.now();
    if (!arranque.current) {
      for (const c of enCocina) {
        const antes = pendientesPrev.current.get(c.id);
        const ahoraPend = lineasPendientes(c).length;
        if (antes === undefined) reproducir('nueva');
        else if (ahoraPend > antes) reproducir('regresa'); // pidió más (09 §6.3)
        // Tic UNA vez al cruzar a rojo (09 §6.5).
        const ini = inicioEspera(c);
        const tier = tierPorMinutos(ini ? (ahoraMs - ini) / 60_000 : 0, catalogo.umbrales);
        if (tier === 'rojo' && tierPrev.current.get(c.id) !== 'rojo') reproducir('tic');
      }
      for (const x of cancel) {
        if (!canceladasPrev.current.has(x.comanda.id)) reproducir('cancela');
      }
    }
    arranque.current = false;
    pendientesPrev.current = new Map(enCocina.map((c) => [c.id, lineasPendientes(c).length]));
    canceladasPrev.current = new Set(cancel.map((x) => x.comanda.id));
    tierPrev.current = new Map(
      enCocina.map((c) => {
        const ini = inicioEspera(c);
        return [c.id, tierPorMinutos(ini ? (ahoraMs - ini) / 60_000 : 0, catalogo.umbrales)];
      }),
    );

    setComandas(enCocina);
    setCanceladas(cancel);
  }

  // Refresco de datos: sincroniza y relee el log cada 3 s (cocina es tiempo real).
  useEffect(() => {
    void recargar();
    const t = setInterval(() => {
      onSincronizar();
      void recargar();
    }, 3_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tic del cronómetro cada segundo (solo pinta; no toca datos).
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);

  async function marcarLista(comandaId: string) {
    // El evento de cocina debe ir DESPUÉS de todo lo que ya sabe de la comanda.
    constructor.observar(hlcMaximo(await motor.almacen.log(), comandaId));
    await motor.sync.crear(constructor.marcarLista(comandaId));
    onSincronizar();
    await recargar();
  }

  async function cancelarLinea(comandaId: string, detalleId: string) {
    // Cocina cancela sin merma (RF-F-13/14). Motivo fijo del contexto de cocina.
    constructor.observar(hlcMaximo(await motor.almacen.log(), comandaId));
    await motor.sync.crear(constructor.cancelarLinea(comandaId, detalleId, 'no se puede preparar'));
    setMenu(null);
    onSincronizar();
    await recargar();
  }

  // RF-F-10: cocina marca un producto no disponible ("se acabó"). Va al servidor
  // directo, no al log de eventos: el catálogo no es event-sourced.
  async function noHay(productoId: string) {
    try {
      await marcarDisponibilidad(sesion.acceso, productoId, false);
    } catch {
      /* sin red: se reintenta manual; el catálogo se refresca al reconectar */
    }
    setMenu(null);
  }

  function cambiarVolumen(v: number) {
    setVolumen(v);
    fijarVolumen(v);
  }

  const pendientesAlerta = canceladas.filter((x) => !reconocidas.has(x.comanda.id));

  return (
    <div className="flex h-full flex-col bg-piedra-950 text-white" onClick={desbloquearAudio}>
      <header className="flex items-center justify-between px-4 py-2 text-sm">
        <span className="font-semibold uppercase tracking-wide">Cocina</span>
        <span className={enLinea ? 'text-ok' : 'text-error'}>{enLinea ? '● En línea' : '⚠ Sin red'}</span>
        <div className="flex items-center gap-3">
          <span className="text-piedra-400">{comandas.length} comandas</span>
          <button
            type="button"
            onClick={() => setAjustes((v) => !v)}
            aria-label="ajustes de sonido"
            className="text-lg"
          >
            🔊
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm('¿Cerrar sesión y cambiar de usuario?')) onSalir();
            }}
            aria-label="cerrar sesión"
            className="rounded-md px-2 py-1 font-semibold text-piedra-400"
          >
            Salir
          </button>
        </div>
      </header>

      {/* Ajustes de sonido (09 §6.5): volumen + prueba. Un sonido que no se oye
          no existe, y una cocina en hora pico es más ruidosa que una oficina. */}
      {ajustes && (
        <div className="flex items-center gap-3 border-b border-piedra-800 bg-piedra-900 px-4 py-3">
          <span>Volumen</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={volumen}
            onChange={(e) => cambiarVolumen(Number(e.target.value))}
            className="flex-1"
          />
          <button
            type="button"
            onClick={() => {
              desbloquearAudio();
              reproducir('nueva');
            }}
            className="tactil rounded-md bg-white/20 px-3 py-1"
          >
            Probar
          </button>
        </div>
      )}

      {/* Alertas de cancelación (RF-F-11): se quedan hasta reconocer. */}
      {pendientesAlerta.length > 0 && (
        <div className="flex gap-3 overflow-x-auto border-b border-piedra-800 bg-piedra-900 p-3">
          {pendientesAlerta.map((x) => (
            <div key={x.comanda.id} className="min-w-[280px] rounded-lg border-t-8 border-[#F87171] bg-[#991B1B] p-3">
              <p className="text-lg font-bold">⛔ CANCELADA · {etiquetaDe(x.comanda)}</p>
              <ul className="my-2 text-piedra-200 line-through">
                {x.comanda.lineas.map((l) => (
                  <li key={l.id}>
                    {l.cantidad}× {l.nombreProducto}
                  </li>
                ))}
              </ul>
              {x.motivo && <p className="italic text-piedra-200">«{x.motivo}»</p>}
              <button
                type="button"
                onClick={() => setReconocidas((s) => new Set(s).add(x.comanda.id))}
                className="tactil mt-2 w-full rounded-md bg-white/20 py-2 font-semibold active:bg-white/30"
              >
                ENTENDIDO
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Riel de comandas: la más vieja a la izquierda. */}
      <div className="flex flex-1 gap-3 overflow-x-auto p-3">
        {comandas.length === 0 && <p className="m-auto text-piedra-500">Sin comandas en cocina</p>}
        {comandas.map((c) => {
          const inicio = inicioEspera(c);
          const ms = inicio ? ahora - inicio : 0;
          const tier = tierPorMinutos(ms / 60_000, catalogo.umbrales);
          const col = COLOR_TIER[tier];
          const pend = lineasPendientes(c);
          const serv = lineasServidas(c);
          const regreso = serv.length > 0; // ya sirvió algo y volvió (09 §6.3)
          const visibles = pend.slice(0, MAX_LINEAS_VISIBLES);
          const ocultas = pend.length - visibles.length;
          return (
            <div
              key={c.id}
              className={`flex min-w-[300px] max-w-[320px] flex-col rounded-lg ${col.pulsa ? 'animate-pulse' : ''}`}
              style={{ backgroundColor: col.relleno, borderTop: `8px solid ${col.borde}` }}
            >
              <div className="flex items-center justify-between px-4 pt-3">
                <span className="text-3xl font-bold tabular-nums">
                  {col.chip} {mmss(ms)}
                </span>
                <span className="text-lg font-semibold">{etiquetaDe(c)}</span>
              </div>

              <ul className="flex-1 overflow-y-auto px-4 py-2">
                {/* Badge de comanda que regresó (09 §6.3). */}
                {regreso && (
                  <li className="mb-1 inline-block rounded bg-[#FACC15] px-2 py-0.5 text-sm font-bold text-black">
                    ➕ AGREGADO
                  </li>
                )}
                {visibles.map((l) => (
                  <li key={l.id} className="py-1 text-[28px] font-bold leading-tight">
                    {l.cantidad}× {l.nombreProducto}
                    {l.notas && <span className="block text-xl font-normal text-piedra-300">↳ {l.notas}</span>}
                  </li>
                ))}
                {ocultas > 0 && <li className="py-1 text-lg text-piedra-300">+{ocultas} más…</li>}
                {serv.map((l) => (
                  <li key={l.id} className="py-1 text-lg text-piedra-400 line-through">
                    {l.cantidad}× {l.nombreProducto} · servido
                  </li>
                ))}
              </ul>

              <div className="flex items-center justify-between p-3">
                <button
                  type="button"
                  onClick={() => void marcarLista(c.id)}
                  aria-label="marcar lista"
                  className="flex h-[88px] w-[88px] items-center justify-center rounded-full bg-[#15803D] text-4xl active:opacity-90"
                >
                  ✓
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setMenu(menu === c.id ? null : c.id)}
                    aria-label="menú"
                    className="tactil text-2xl"
                  >
                    ⋮
                  </button>
                  {menu === c.id && (
                    <div className="absolute bottom-12 right-0 w-56 rounded-md bg-piedra-800 p-1 shadow-lg">
                      {pend.map((l) => (
                        <div key={l.id} className="border-b border-piedra-700 last:border-0">
                          <button
                            type="button"
                            onClick={() => void noHay(l.productoId)}
                            className="block w-full rounded px-3 py-2 text-left text-sm active:bg-piedra-700"
                          >
                            No hay: {l.nombreProducto}
                          </button>
                          <button
                            type="button"
                            onClick={() => void cancelarLinea(c.id, l.id)}
                            className="block w-full rounded px-3 py-2 text-left text-sm text-[#FCA5A5] active:bg-piedra-700"
                          >
                            No puedo prepararla: {l.nombreProducto}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
