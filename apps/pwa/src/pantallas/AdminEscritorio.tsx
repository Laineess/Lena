// Escritorio de gestión (09 §7). Topbar + tema oscuro (negro/rojo/dorado).
// Dos niveles: superadmin (global, con selector de sucursal, alta de sucursales
// y administradores) y administrador (acotado a su sucursal). El turno de caja
// (abrir/cerrar) vive aquí, no en el mesero. Tipografía Arial (global).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatearMoneda } from '@lena/shared';
import { abrirTurno, admin, cerrarTurno, exportarCsv, obtenerCatalogo, turnoActual } from '../dominio/api';
import type {
  CajaDia,
  Cancelada,
  Catalogo,
  ComandaDetalle,
  ComandaDia,
  Corte,
  MasVendido,
  ProductoCat,
  ReporteMerma,
  Resumen,
  Sucursal,
  TurnoActual,
  UsuarioAdmin,
} from '../dominio/api';

type Rol = 'superadmin' | 'administrador' | 'cocina' | 'mesero';
type Seccion =
  | 'inicio'
  | 'caja'
  | 'merma'
  | 'canceladas'
  | 'cortes'
  | 'productos'
  | 'gastos'
  | 'usuarios'
  | 'sucursales'
  | 'admins';

const SECCIONES: { id: Seccion; nombre: string; alerta?: boolean; super?: boolean }[] = [
  { id: 'inicio', nombre: 'Inicio' },
  { id: 'caja', nombre: 'Caja del día' },
  { id: 'merma', nombre: 'Merma', alerta: true },
  { id: 'canceladas', nombre: 'Canceladas' },
  { id: 'cortes', nombre: 'Cortes' },
  { id: 'productos', nombre: 'Productos' },
  { id: 'gastos', nombre: 'Gastos' },
  { id: 'usuarios', nombre: 'Usuarios' },
  { id: 'sucursales', nombre: 'Sucursales', super: true },
  { id: 'admins', nombre: 'Administradores', super: true },
];

const CARD = 'rounded-lg border border-carbon-700 bg-carbon-900';
const INPUT =
  'rounded-md border border-carbon-600 bg-carbon-800 px-2 py-1 text-piedra-100 placeholder-piedra-500 [color-scheme:dark]';
const BTN = 'rounded-md bg-rojo-600 px-3 py-1 font-bold text-white hover:bg-rojo-500 disabled:opacity-40';

export function AdminEscritorio({ token, rol, onSalir }: { token: string; rol: Rol; onSalir: () => void }) {
  const esSuper = rol === 'superadmin';
  const [seccion, setSeccion] = useState<Seccion>('inicio');
  const hoy = useMemo(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date()), []);
  const [desde, setDesde] = useState(hoy);
  const [hasta, setHasta] = useState(hoy);
  const [sucursal, setSucursal] = useState(''); // filtro superadmin; '' = todas
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);

  const recargarSucursales = useCallback(() => {
    admin
      .sucursales(token)
      .then(setSucursales)
      .catch(() => setSucursales([]));
  }, [token]);
  useEffect(() => recargarSucursales(), [recargarSucursales]);

  const secciones = SECCIONES.filter((s) => !s.super || esSuper);
  const props = { token, desde, hasta, sucursal };
  // El administrador tiene una sola sucursal (la suya); útil para Inicio/Caja.
  const suPropia = !esSuper ? sucursales[0] : undefined;

  return (
    <div className="flex h-full flex-col bg-carbon-950 text-piedra-200">
      {/* Topbar */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-carbon-800 bg-carbon-900 px-4 py-2">
        <span className="flex items-center gap-2 text-h2 font-bold text-oro-400">
          <img src="/icon.svg" alt="" className="h-6 w-6 rounded-md" /> Leña
        </span>
        <span className="hidden text-xs uppercase tracking-wide text-piedra-500 md:inline">
          {esSuper ? 'Dueño' : 'Gerencia'}
        </span>
        <nav className="flex flex-1 flex-wrap items-center gap-1">
          {secciones.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSeccion(s.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-bold ${
                seccion === s.id ? 'bg-carbon-800 text-oro-300' : 'text-piedra-400 hover:bg-carbon-800'
              }`}
            >
              {s.nombre} {s.alerta && <span className="text-rojo-400">⚠</span>}
            </button>
          ))}
        </nav>
        <button type="button" onClick={onSalir} className="text-sm font-bold text-piedra-400 hover:text-piedra-200">
          Salir ›
        </button>
      </header>

      {/* Sub-barra: rango de fechas + selector de sucursal */}
      <div className="flex flex-wrap items-center gap-2 border-b border-carbon-800 px-4 py-2">
        <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={INPUT} />
        <span className="text-piedra-500">→</span>
        <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={INPUT} />
        {esSuper && (
          <select value={sucursal} onChange={(e) => setSucursal(e.target.value)} className={`${INPUT} ml-2`}>
            <option value="">Todas las sucursales</option>
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        )}
      </div>

      <main className="flex-1 overflow-y-auto p-6">
        {seccion === 'inicio' && <PanelInicio {...props} esSuper={esSuper} suPropia={suPropia} />}
        {seccion === 'caja' && <PanelCaja token={token} sucursal={sucursal} />}
        {seccion === 'merma' && <PanelMerma {...props} />}
        {seccion === 'canceladas' && <PanelCanceladas {...props} />}
        {seccion === 'cortes' && <PanelCortes {...props} />}
        {seccion === 'productos' && <PanelProductos token={token} esSuper={esSuper} sucursal={sucursal} />}
        {seccion === 'usuarios' && <PanelUsuarios token={token} esSuper={esSuper} sucursal={sucursal} sucursales={sucursales} />}
        {seccion === 'gastos' && <PanelGastos {...props} sucursales={sucursales} esSuper={esSuper} />}
        {seccion === 'sucursales' && <PanelSucursales token={token} sucursal={sucursal} onCambio={recargarSucursales} />}
        {seccion === 'admins' && <PanelAdmins token={token} sucursal={sucursal} sucursales={sucursales} />}
      </main>

      <AlertasSync token={token} />
    </div>
  );
}

interface RangoProps {
  token: string;
  desde: string;
  hasta: string;
  sucursal: string;
}

// ── Inicio: KPIs + turno de caja + tendencias ──
function PanelInicio({
  token,
  desde,
  hasta,
  sucursal,
  esSuper,
  suPropia,
}: RangoProps & { esSuper: boolean; suPropia: Sucursal | undefined }) {
  const [r, setR] = useState<Resumen | null>(null);
  const [top, setTop] = useState<MasVendido[]>([]);
  const [balance, setBalance] = useState<{ ingresos: number; gastos: number; balance: number } | null>(null);
  useEffect(() => {
    admin.resumen(token, desde, hasta, sucursal).then(setR).catch(() => setR(null));
    admin.masVendidos(token, desde, hasta, sucursal).then(setTop).catch(() => setTop([]));
    admin.ingresosVsGastos(token, desde, hasta, sucursal).then(setBalance).catch(() => setBalance(null));
  }, [token, desde, hasta, sucursal]);

  return (
    <div>
      {/* El administrador abre/cierra el día aquí. El superadmin lo hace cada
          gerente en su sucursal; el superadmin lo observa en Caja del día. */}
      {!esSuper && <TurnoCaja token={token} sucursal={suPropia} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi titulo="Ventas" valor={formatearMoneda(r?.ventas ?? 0)} />
        <Kpi titulo="Comandas" valor={String(r?.comandas ?? 0)} />
        <Kpi titulo="Ticket promedio" valor={formatearMoneda(r?.ticket ?? 0)} />
        <Kpi titulo="Merma" valor={formatearMoneda(r?.merma ?? 0)} alerta />
      </div>

      {/* Balance del periodo (RF-I-5). */}
      <h3 className="mb-2 mt-6 text-sm font-bold uppercase tracking-wide text-piedra-500">Ingresos vs. gastos</h3>
      <div className="grid grid-cols-3 gap-3">
        <Kpi titulo="Ingresos" valor={formatearMoneda(balance?.ingresos ?? 0)} />
        <Kpi titulo="Gastos" valor={formatearMoneda(balance?.gastos ?? 0)} />
        <div className={`p-4 ${CARD}`}>
          <p className={`text-2xl font-bold tabular-nums ${(balance?.balance ?? 0) < 0 ? 'text-rojo-400' : 'text-ok'}`}>
            {formatearMoneda(balance?.balance ?? 0)}
          </p>
          <p className="text-sm text-piedra-500">Balance</p>
        </div>
      </div>

      <h3 className="mb-2 mt-6 text-sm font-bold uppercase tracking-wide text-piedra-500">Más vendidos</h3>
      <ol className={CARD}>
        {top.slice(0, 5).map((p, i) => (
          <li key={p.nombre} className="flex justify-between border-b border-carbon-800 px-3 py-2 last:border-0">
            <span>
              <span className="font-bold text-oro-400">{i + 1}.</span> {p.nombre}
            </span>
            <span className="tabular-nums text-piedra-400">{p.unidades}</span>
          </li>
        ))}
        {top.length === 0 && <li className="px-3 py-2 text-piedra-500">Sin datos</li>}
      </ol>
    </div>
  );
}

// Abrir/cerrar el turno de la sucursal del administrador (RF-H).
function TurnoCaja({ token, sucursal }: { token: string; sucursal: Sucursal | undefined }) {
  const [turno, setTurno] = useState<TurnoActual | null>(null);
  const [cargado, setCargado] = useState(false);
  const [fondo, setFondo] = useState('');
  const [contado, setContado] = useState('');
  const [motivo, setMotivo] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const cargar = useCallback(() => {
    turnoActual(token).then((t) => { setTurno(t); setCargado(true); }).catch(() => setCargado(true));
  }, [token]);
  useEffect(() => cargar(), [cargar]);

  async function abrir() {
    setMsg(null);
    const pesos = Number(fondo);
    if (!(pesos >= 0)) return;
    await abrirTurno(token, Math.round(pesos * 100));
    setFondo('');
    cargar();
  }
  async function cerrar() {
    setMsg(null);
    const pesos = Number(contado);
    if (!(pesos >= 0)) return;
    const r = await cerrarTurno(token, Math.round(pesos * 100), motivo || undefined);
    if (r.ok) {
      setMsg(`Turno cerrado. Diferencia: ${formatearMoneda(r.cierre.diferencia)}`);
      setContado('');
      setMotivo('');
      cargar();
    } else if (r.error === 'comandas_abiertas') {
      setMsg(`No se puede cerrar: hay ${r.comandas?.length ?? ''} comanda(s) sin cobrar.`);
    } else if (r.error === 'motivo_requerido') {
      setMsg('La diferencia es grande: escribe un motivo.');
    } else {
      setMsg('No se pudo cerrar.');
    }
  }

  return (
    <div className={`mb-5 p-4 ${CARD}`}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-h2 font-bold text-piedra-100">Caja / Turno del día</h3>
        {sucursal && (
          <span className="text-sm text-piedra-400">
            Clave de tu sucursal: <span className="font-bold tracking-widest text-oro-300">{sucursal.clave}</span>
          </span>
        )}
      </div>
      {!cargado ? (
        <p className="text-piedra-500">Cargando…</p>
      ) : turno ? (
        <div className="flex flex-wrap items-end gap-3">
          <p className="text-piedra-300">
            <span className="font-bold text-ok">● Turno abierto</span> · fondo{' '}
            <span className="tabular-nums">{formatearMoneda(turno.fondoInicial)}</span>
          </p>
          <input value={contado} onChange={(e) => setContado(e.target.value)} placeholder="Efectivo contado $" type="number" className={`w-40 tabular-nums ${INPUT}`} />
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (si hay diferencia)" className={INPUT} />
          <button type="button" onClick={() => void cerrar()} className={BTN}>Cerrar turno</button>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <p className="text-piedra-400">No hay turno abierto. Ábrelo para que los meseros puedan cobrar.</p>
          <input value={fondo} onChange={(e) => setFondo(e.target.value)} placeholder="Fondo inicial $" type="number" className={`w-40 tabular-nums ${INPUT}`} />
          <button type="button" onClick={() => void abrir()} className={BTN}>Abrir turno</button>
        </div>
      )}
      {msg && <p className="mt-2 font-bold text-oro-300">{msg}</p>}
    </div>
  );
}

// ── Caja del día: lista de comandas de hoy + detalle al hacer clic ──
function PanelCaja({ token, sucursal }: { token: string; sucursal: string }) {
  const [caja, setCaja] = useState<CajaDia[]>([]);
  const [comandas, setComandas] = useState<ComandaDia[]>([]);
  const [detalle, setDetalle] = useState<ComandaDetalle | null>(null);

  const cargar = useCallback(() => {
    admin.caja(token, sucursal).then(setCaja).catch(() => setCaja([]));
    admin.comandasDia(token, sucursal).then(setComandas).catch(() => setComandas([]));
  }, [token, sucursal]);
  useEffect(() => {
    cargar();
    const t = setInterval(cargar, 15_000); // se mantiene al día tras cada cobro
    return () => clearInterval(t);
  }, [cargar]);

  return (
    <div>
      <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        {caja.map((c) => (
          <div key={c.sucursalId} className={`p-4 ${CARD}`}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-h2 font-bold text-oro-300">{c.sucursal}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${c.turnoAbierto ? 'text-ok' : 'text-piedra-400'}`}>
                {c.turnoAbierto ? '● Turno abierto' : 'Turno cerrado'}
              </span>
            </div>
            <p className="text-3xl font-bold tabular-nums text-piedra-100">{formatearMoneda(c.ventas)}</p>
            <p className="text-sm text-piedra-500">
              venta cobrada hoy · {c.comandas} comandas · {c.comandasAbiertas} sin cobrar
            </p>
          </div>
        ))}
      </div>

      <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-piedra-500">Comandas de hoy</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-carbon-700 text-left text-piedra-500">
            <th className="py-2">Folio</th>
            <th>Tipo</th>
            <th>Mesa</th>
            <th>Mesero</th>
            <th>Total</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {comandas.map((c) => (
            <tr
              key={c.id}
              onClick={() => admin.comandaDetalle(token, c.id).then(setDetalle).catch(() => {})}
              className="cursor-pointer border-b border-carbon-800 hover:bg-carbon-800"
            >
              <td className="py-2 tabular-nums">{c.folio ?? '—'}</td>
              <td className="capitalize text-piedra-400">{c.tipoServicio.replace('_', ' ')}</td>
              <td className="text-piedra-400">{c.mesa ?? '—'}</td>
              <td className="text-piedra-400">{c.mesero ?? '—'}</td>
              <td className="tabular-nums">{formatearMoneda(c.total)}</td>
              <td><EstadoBadge estado={c.estado} /></td>
            </tr>
          ))}
          {comandas.length === 0 && (
            <tr>
              <td colSpan={6} className="py-3 text-piedra-500">Sin comandas hoy</td>
            </tr>
          )}
        </tbody>
      </table>

      {detalle && (
        <DetalleComanda
          token={token}
          detalle={detalle}
          onCerrar={() => setDetalle(null)}
          onReabierta={() => { setDetalle(null); cargar(); }}
        />
      )}
    </div>
  );
}

function EstadoBadge({ estado }: { estado: string }) {
  const color =
    estado === 'cobrada' ? 'text-ok' : estado === 'cancelada' ? 'text-rojo-400' : 'text-oro-300';
  return <span className={`font-bold ${color}`}>{estado}</span>;
}

function DetalleComanda({
  token,
  detalle,
  onCerrar,
  onReabierta,
}: {
  token: string;
  detalle: ComandaDetalle;
  onCerrar: () => void;
  onReabierta: () => void;
}) {
  async function reabrir() {
    const motivo = prompt('Motivo para reabrir esta comanda cobrada:');
    if (!motivo?.trim()) return;
    try {
      await admin.reabrirComanda(token, detalle.id, motivo.trim());
      onReabierta();
    } catch {
      alert('No se pudo reabrir.');
    }
  }
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={onCerrar}>
      <div className={`max-h-[85vh] w-full max-w-md overflow-y-auto p-5 ${CARD}`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-h2 font-bold text-oro-300">
            Comanda {detalle.folio ? `#${detalle.folio}` : ''}
          </h3>
          <button type="button" onClick={onCerrar} className="text-piedra-400 hover:text-piedra-200">✕</button>
        </div>
        <p className="mb-3 text-sm text-piedra-400">
          <span className="capitalize">{detalle.tipoServicio.replace('_', ' ')}</span>
          {detalle.mesa ? ` · ${detalle.mesa}` : ''} · {detalle.mesero ?? '—'} · <EstadoBadge estado={detalle.estado} />
        </p>
        <ul className="mb-3 border-y border-carbon-800 py-2">
          {detalle.lineas.map((l, i) => (
            <li key={i} className={`flex justify-between py-1 ${l.estado === 'cancelada' ? 'text-piedra-500 line-through' : ''}`}>
              <span>
                {l.cantidad}× {l.nombre}
                {l.notas && <span className="block text-xs text-piedra-500">↳ {l.notas}</span>}
              </span>
              <span className="tabular-nums text-piedra-300">{formatearMoneda(l.precio * l.cantidad)}</span>
            </li>
          ))}
        </ul>
        {detalle.pagos.length > 0 && (
          <div className="mb-2 text-sm">
            {detalle.pagos.map((p, i) => (
              <p key={i} className="flex justify-between text-piedra-400">
                <span className="capitalize">{p.metodo}</span>
                <span className="tabular-nums">{formatearMoneda(p.monto)}</span>
              </p>
            ))}
          </div>
        )}
        {detalle.motivoCancelacion && (
          <p className="mb-2 text-sm italic text-rojo-400">Cancelada: «{detalle.motivoCancelacion}»</p>
        )}
        <p className="flex justify-between text-lg font-bold">
          <span>Total</span>
          <span className="tabular-nums text-oro-300">{formatearMoneda(detalle.total)}</span>
        </p>
        {/* Reabrir una comanda ya cobrada (RF-G-8): queda registrado con motivo. */}
        {detalle.estado === 'cobrada' && (
          <button type="button" onClick={() => void reabrir()} className={`mt-4 w-full ${BTN}`}>
            Reabrir comanda
          </button>
        )}
      </div>
    </div>
  );
}

function PanelMerma({ token, desde, hasta, sucursal }: RangoProps) {
  const [r, setR] = useState<ReporteMerma | null>(null);
  useEffect(() => {
    admin.merma(token, desde, hasta, sucursal).then(setR).catch(() => setR(null));
  }, [token, desde, hasta, sucursal]);
  const sospechosos = (r?.meseros ?? []).some((m) => m.vsEquipo >= 2);
  return (
    <div>
      <h2 className="mb-3 text-h2 font-bold text-piedra-100">Merma y cancelaciones</h2>
      <p className="mb-4 text-piedra-400">
        Merma total: <span className="font-bold text-rojo-400">{formatearMoneda(r?.total ?? 0)}</span>
      </p>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-carbon-700 text-left text-piedra-500">
            <th className="py-2">Mesero</th><th>Comandas</th><th>Canceladas</th><th>Tasa</th><th>Merma</th><th>vs. equipo</th>
          </tr>
        </thead>
        <tbody>
          {(r?.meseros ?? []).map((m) => {
            const s = m.vsEquipo >= 2;
            return (
              <tr key={m.id} className={`border-b border-carbon-800 ${s ? 'bg-rojo-700/20' : ''}`}>
                <td className="py-2 font-bold">{m.nombre}</td>
                <td className="tabular-nums">{m.comandas}</td>
                <td className="tabular-nums">{m.canceladas}</td>
                <td className="tabular-nums">{(m.tasa * 100).toFixed(1)}%</td>
                <td className="tabular-nums">{formatearMoneda(m.merma)}</td>
                <td className={`tabular-nums font-bold ${s ? 'text-rojo-400' : 'text-piedra-500'}`}>{s ? `⚠ ${m.vsEquipo.toFixed(1)}×` : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {sospechosos && (
        <p className="mt-3 rounded-md bg-rojo-700/20 p-2 font-bold text-rojo-400">
          ⚠️ Un mesero cancela mucho más que el promedio. Revisar (control antifraude T1).
        </p>
      )}
    </div>
  );
}

function PanelCanceladas({ token, desde, hasta, sucursal }: RangoProps) {
  const [filas, setFilas] = useState<Cancelada[]>([]);
  useEffect(() => {
    admin.canceladas(token, desde, hasta, sucursal).then(setFilas).catch(() => setFilas([]));
  }, [token, desde, hasta, sucursal]);
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-h2 font-bold text-piedra-100">Comandas canceladas</h2>
        <button type="button" onClick={() => void exportarCsv(token, 'canceladas', desde, hasta)} className="text-sm font-bold text-oro-400 underline hover:text-oro-300">
          Exportar CSV
        </button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-carbon-700 text-left text-piedra-500"><th className="py-2">Folio</th><th>Mesero</th><th>Motivo</th><th>Costo mermado</th></tr>
        </thead>
        <tbody>
          {filas.map((c) => (
            <tr key={c.id} className="border-b border-carbon-800">
              <td className="py-2 tabular-nums">{c.folio ?? '—'}</td>
              <td>{c.mesero}</td>
              <td className="text-piedra-400">{c.motivo}</td>
              <td className="tabular-nums text-rojo-400">{formatearMoneda(c.costoMermado)}</td>
            </tr>
          ))}
          {filas.length === 0 && <tr><td colSpan={4} className="py-3 text-piedra-500">Sin cancelaciones en el periodo</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function PanelCortes({ token, desde, hasta, sucursal }: RangoProps) {
  const [filas, setFilas] = useState<Corte[]>([]);
  useEffect(() => {
    admin.cortes(token, desde, hasta, sucursal).then(setFilas).catch(() => setFilas([]));
  }, [token, desde, hasta, sucursal]);
  return (
    <div>
      <h2 className="mb-3 text-h2 font-bold text-piedra-100">Historial de cortes</h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-carbon-700 text-left text-piedra-500"><th className="py-2">Cerrado</th><th>Esperado</th><th>Contado</th><th>Diferencia</th><th>Tarjeta</th><th>Transfer.</th></tr>
        </thead>
        <tbody>
          {filas.map((c) => (
            <tr key={c.id} className="border-b border-carbon-800">
              <td className="py-2 text-piedra-400">{c.cerradoAt?.slice(0, 16).replace('T', ' ')}</td>
              <td className="tabular-nums">{formatearMoneda(c.esperado)}</td>
              <td className="tabular-nums">{formatearMoneda(c.contado)}</td>
              <td className={`tabular-nums ${c.diferencia !== 0 ? 'font-bold text-rojo-400' : 'text-ok'}`}>{formatearMoneda(c.diferencia)}</td>
              <td className="tabular-nums">{formatearMoneda(c.tarjeta)}</td>
              <td className="tabular-nums">{formatearMoneda(c.transferencia)}</td>
            </tr>
          ))}
          {filas.length === 0 && <tr><td colSpan={6} className="py-3 text-piedra-500">Sin cortes cerrados en el periodo</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// Productos: menú del negocio (RF-D). Alta/edición/baja + agotado/reactivar,
// organizado por categoría → subcategoría (texto libre que el admin escribe al
// dar de alta). Admin y superadmin (el menú es global, RF-D-9).
function PanelProductos({ token, esSuper, sucursal }: { token: string; esSuper: boolean; sucursal: string }) {
  const [cat, setCat] = useState<Catalogo | null>(null);
  const [editPrecio, setEditPrecio] = useState<Record<string, string>>({});
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ nombre: '', categoria: '', subcategoria: '' });
  const [nuevo, setNuevo] = useState({ nombre: '', categoria: '', subcategoria: '', precio: '' });
  const [error, setError] = useState<string | null>(null);
  const [historial, setHistorial] = useState<{ nombre: string; filas: { precioAnterior: string; precioNuevo: string; createdAt: string }[] } | null>(null);
  const [catEdit, setCatEdit] = useState<Record<string, string>>({});
  const [subEdit, setSubEdit] = useState<Record<string, string>>({});
  const [precioSuc, setPrecioSuc] = useState<Record<string, string>>({});

  // El admin ve la disponibilidad de SU sucursal; el superadmin, la de la que
  // filtre arriba. Sin sucursal elegida (superadmin, "Todas") no se puede
  // gestionar existencias (son por sucursal).
  const gestionable = !esSuper || !!sucursal;
  const cargar = useCallback(
    async () => setCat(await obtenerCatalogo(token, esSuper ? sucursal || undefined : undefined)),
    [token, esSuper, sucursal],
  );
  useEffect(() => { void cargar(); }, [cargar]);

  const catNombre = useMemo(() => new Map((cat?.categorias ?? []).map((c) => [c.id, c.nombre])), [cat]);
  const listaCategorias = useMemo(() => (cat?.categorias ?? []).map((c) => c.nombre), [cat]);
  const listaSub = useMemo(
    () => [...new Set((cat?.productos ?? []).map((p) => p.subcategoria).filter((s): s is string => !!s))],
    [cat],
  );
  // categoriaId → subcategoría → productos.
  const grupos = useMemo(() => {
    const m = new Map<string, Map<string, ProductoCat[]>>();
    for (const p of cat?.productos ?? []) {
      const sub = p.subcategoria || 'Sin subcategoría';
      if (!m.has(p.categoriaId)) m.set(p.categoriaId, new Map());
      const sm = m.get(p.categoriaId) as Map<string, ProductoCat[]>;
      if (!sm.has(sub)) sm.set(sub, []);
      (sm.get(sub) as ProductoCat[]).push(p);
    }
    return m;
  }, [cat]);

  async function crear() {
    setError(null);
    const precio = Number(nuevo.precio);
    if (!nuevo.nombre.trim() || !nuevo.categoria.trim() || !(precio > 0)) {
      setError('Faltan nombre, categoría o precio.');
      return;
    }
    try {
      await admin.crearProducto(token, {
        nombre: nuevo.nombre,
        categoria: nuevo.categoria,
        precio: Math.round(precio * 100),
        ...(nuevo.subcategoria.trim() ? { subcategoria: nuevo.subcategoria } : {}),
      });
      setNuevo({ nombre: '', categoria: '', subcategoria: '', precio: '' });
      await cargar();
    } catch {
      setError('No se pudo crear.');
    }
  }

  async function guardarPrecio(id: string) {
    const pesos = Number(editPrecio[id]);
    if (!pesos) return;
    await admin.cambiarPrecio(token, id, Math.round(pesos * 100));
    setEditPrecio((e) => { const n = { ...e }; delete n[id]; return n; });
    await cargar();
  }
  async function guardarEdicion() {
    if (!editId) return;
    await admin.editarProducto(token, editId, {
      nombre: editForm.nombre,
      categoria: editForm.categoria,
      subcategoria: editForm.subcategoria,
    });
    setEditId(null);
    await cargar();
  }
  async function guardarCategoria(catId: string) {
    const n = (catEdit[catId] ?? '').trim();
    if (!n) return;
    await admin.editarCategoria(token, catId, { nombre: n });
    setCatEdit((c) => { const x = { ...c }; delete x[catId]; return x; });
    await cargar();
  }
  async function guardarSub(oldSub: string) {
    const n = (subEdit[oldSub] ?? '').trim();
    if (!n || n === oldSub) return;
    await admin.renombrarSubcategoria(token, oldSub, n);
    setSubEdit((s) => { const x = { ...s }; delete x[oldSub]; return x; });
    await cargar();
  }
  async function fijarPrecioSuc(id: string) {
    const pesos = Number(precioSuc[id]);
    if (!(pesos > 0)) return;
    await admin.fijarPrecioSucursal(token, id, Math.round(pesos * 100), esSuper ? sucursal : undefined);
    setPrecioSuc((s) => { const x = { ...s }; delete x[id]; return x; });
    await cargar();
  }
  async function quitarPrecioSuc(id: string) {
    await admin.quitarPrecioSucursal(token, id, esSuper ? sucursal : undefined);
    await cargar();
  }

  return (
    <div>
      <h2 className="mb-1 text-h2 font-bold text-piedra-100">Productos</h2>
      <p className="mb-1 text-sm text-piedra-500">
        El menú es del negocio (aplica a todas las sucursales). La categoría y subcategoría las escribes al dar de alta.
      </p>
      <p className="mb-3 text-sm text-piedra-400">
        {gestionable
          ? 'Existencias mostradas de la sucursal seleccionada. Agotar/reactivar afecta solo a esa sucursal.'
          : '⚠ Elige una sucursal arriba para ver y cambiar existencias (agotado/disponible es por sucursal).'}
      </p>

      {/* Alta */}
      <div className={`mb-5 flex flex-wrap items-end gap-2 p-3 ${CARD}`}>
        <input value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} placeholder="Nombre" className={INPUT} />
        <input list="cats" value={nuevo.categoria} onChange={(e) => setNuevo({ ...nuevo, categoria: e.target.value })} placeholder="Categoría (p. ej. Bebidas)" className={INPUT} />
        <input list="subs" value={nuevo.subcategoria} onChange={(e) => setNuevo({ ...nuevo, subcategoria: e.target.value })} placeholder="Subcategoría (p. ej. Jugos)" className={INPUT} />
        <input value={nuevo.precio} onChange={(e) => setNuevo({ ...nuevo, precio: e.target.value })} placeholder="Precio $" type="number" className={`w-28 tabular-nums ${INPUT}`} />
        <button type="button" onClick={() => void crear()} className={BTN}>Agregar producto</button>
        {error && <span className="font-bold text-rojo-400">{error}</span>}
        <datalist id="cats">{listaCategorias.map((c) => <option key={c} value={c} />)}</datalist>
        <datalist id="subs">{listaSub.map((s) => <option key={s} value={s} />)}</datalist>
      </div>

      {/* Listado por categoría → subcategoría */}
      {[...grupos.entries()].map(([catId, subs]) => (
        <div key={catId} className="mb-5">
          <div className="mb-1 flex items-center gap-2">
            <h3 className="text-h2 font-bold text-oro-300">{catNombre.get(catId) ?? '—'}</h3>
            <input
              value={catEdit[catId] ?? ''}
              onChange={(e) => setCatEdit((c) => ({ ...c, [catId]: e.target.value }))}
              placeholder="renombrar categoría"
              className={`w-40 text-sm ${INPUT}`}
            />
            <button type="button" disabled={!(catEdit[catId] ?? '').trim()} onClick={() => void guardarCategoria(catId)} className="text-sm font-bold text-oro-400 hover:text-oro-300 disabled:text-piedra-600">✓</button>
          </div>
          {[...subs.entries()].map(([sub, prods]) => (
            <div key={sub} className="mb-2">
              <div className="mb-1 flex items-center gap-2">
                <p className="text-xs font-bold uppercase tracking-wide text-piedra-500">{sub}</p>
                {sub !== 'Sin subcategoría' && (
                  <>
                    <input
                      value={subEdit[sub] ?? ''}
                      onChange={(e) => setSubEdit((s) => ({ ...s, [sub]: e.target.value }))}
                      placeholder="renombrar subcategoría"
                      className={`w-40 text-xs ${INPUT}`}
                    />
                    <button type="button" disabled={!(subEdit[sub] ?? '').trim()} onClick={() => void guardarSub(sub)} className="text-xs font-bold text-oro-400 hover:text-oro-300 disabled:text-piedra-600">✓</button>
                  </>
                )}
              </div>
              <div className={CARD}>
                {prods.map((p) =>
                  editId === p.id ? (
                    <div key={p.id} className="flex flex-wrap items-end gap-2 border-b border-carbon-800 p-2 last:border-0">
                      <input value={editForm.nombre} onChange={(e) => setEditForm({ ...editForm, nombre: e.target.value })} className={INPUT} />
                      <input list="cats" value={editForm.categoria} onChange={(e) => setEditForm({ ...editForm, categoria: e.target.value })} className={INPUT} />
                      <input list="subs" value={editForm.subcategoria} onChange={(e) => setEditForm({ ...editForm, subcategoria: e.target.value })} placeholder="Subcategoría" className={INPUT} />
                      <button type="button" onClick={() => void guardarEdicion()} className={BTN}>Guardar</button>
                      <button type="button" onClick={() => setEditId(null)} className="text-sm text-piedra-400">Cancelar</button>
                    </div>
                  ) : (
                    <div key={p.id} className="flex flex-wrap items-center gap-3 border-b border-carbon-800 px-3 py-2 last:border-0">
                      <span className="min-w-40 flex-1 font-bold">{p.nombre}</span>
                      <span className="tabular-nums text-piedra-300">{formatearMoneda(p.precio)}</span>
                      <span className={`text-xs font-bold ${p.disponible ? 'text-ok' : 'text-rojo-400'}`}>
                        {p.disponible ? '● disponible' : '✕ agotado'}
                      </span>
                      <input type="number" value={editPrecio[p.id] ?? ''} onChange={(e) => setEditPrecio((s) => ({ ...s, [p.id]: e.target.value }))} className={`w-24 tabular-nums ${INPUT}`} placeholder="nuevo $" />
                      <button type="button" onClick={() => void guardarPrecio(p.id)} disabled={!editPrecio[p.id]} className="text-sm font-bold text-oro-400 hover:text-oro-300 disabled:text-piedra-600">Precio</button>
                      <button
                        type="button"
                        disabled={!gestionable}
                        onClick={() => void admin.cambiarDisponibilidad(token, p.id, !p.disponible, esSuper ? sucursal : undefined).then(cargar)}
                        className="text-sm font-bold text-piedra-300 hover:text-piedra-100 disabled:text-piedra-600"
                      >
                        {p.disponible ? 'Marcar agotado' : 'Reactivar'}
                      </button>
                      {/* Precio por sucursal (RF-D-8): solo con una sucursal elegida. */}
                      {gestionable && (
                        <>
                          <input type="number" value={precioSuc[p.id] ?? ''} onChange={(e) => setPrecioSuc((s) => ({ ...s, [p.id]: e.target.value }))} className={`w-24 tabular-nums ${INPUT}`} placeholder="aquí $" />
                          <button type="button" onClick={() => void fijarPrecioSuc(p.id)} disabled={!precioSuc[p.id]} className="text-sm font-bold text-oro-400 hover:text-oro-300 disabled:text-piedra-600">Fijar aquí</button>
                          <button type="button" onClick={() => void quitarPrecioSuc(p.id)} className="text-sm text-piedra-400 hover:text-piedra-200">Precio general</button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => { setEditId(p.id); setEditForm({ nombre: p.nombre, categoria: catNombre.get(p.categoriaId) ?? '', subcategoria: p.subcategoria ?? '' }); }}
                        className="text-sm text-piedra-400 hover:text-piedra-200"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => admin.historialPrecios(token, p.id).then((filas) => setHistorial({ nombre: p.nombre, filas }))}
                        className="text-sm text-piedra-400 hover:text-piedra-200"
                      >
                        Historial
                      </button>
                      <button
                        type="button"
                        onClick={() => { if (confirm(`¿Dar de baja "${p.nombre}"?`)) void admin.eliminarProducto(token, p.id).then(cargar); }}
                        className="text-sm font-bold text-rojo-400 hover:text-rojo-300"
                      >
                        Borrar
                      </button>
                    </div>
                  ),
                )}
              </div>
            </div>
          ))}
        </div>
      ))}

      {/* Historial de precio (RF-D-4): quién lo cambió y cuándo (control T1). */}
      {historial && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={() => setHistorial(null)}>
          <div className={`w-full max-w-sm p-5 ${CARD}`} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-h2 font-bold text-oro-300">Precios · {historial.nombre}</h3>
              <button type="button" onClick={() => setHistorial(null)} className="text-piedra-400 hover:text-piedra-200">✕</button>
            </div>
            {historial.filas.length === 0 && <p className="text-piedra-500">Sin cambios registrados.</p>}
            {historial.filas.map((h, i) => (
              <p key={i} className="tabular-nums text-piedra-400">
                {h.createdAt.slice(0, 10)}: ${h.precioAnterior} → ${h.precioNuevo}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PanelUsuarios({ token, esSuper, sucursal, sucursales }: { token: string; esSuper: boolean; sucursal: string; sucursales: Sucursal[] }) {
  const [usuarios, setUsuarios] = useState<UsuarioAdmin[]>([]);
  const [nuevo, setNuevo] = useState({ nombre: '', rol: 'mesero', sucursalId: '', pin: '' });
  const [pinEdit, setPinEdit] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const nombreSuc = useMemo(() => new Map(sucursales.map((s) => [s.id, s.nombre])), [sucursales]);
  const cargar = useCallback(async () => setUsuarios(await admin.usuarios(token, sucursal)), [token, sucursal]);

  async function reasignarPin(id: string) {
    setError(null);
    try {
      await admin.cambiarPin(token, id, (pinEdit[id] ?? '').trim());
      setPinEdit((s) => { const n = { ...s }; delete n[id]; return n; });
    } catch {
      setError('PIN inválido (6 dígitos, no obvio).');
    }
  }
  useEffect(() => { void cargar(); }, [cargar]);
  useEffect(() => setNuevo((n) => ({ ...n, sucursalId: sucursales[0]?.id ?? '' })), [sucursales]);

  async function crear() {
    setError(null);
    try {
      await admin.crearUsuario(token, { nombre: nuevo.nombre, rol: nuevo.rol, pin: nuevo.pin, ...(esSuper ? { sucursalId: nuevo.sucursalId } : {}) });
      setNuevo((n) => ({ ...n, nombre: '', pin: '' }));
      await cargar();
    } catch { setError('PIN inválido o datos incompletos'); }
  }

  return (
    <div>
      <h2 className="mb-3 text-h2 font-bold text-piedra-100">Usuarios</h2>
      <div className={`mb-4 flex flex-wrap items-end gap-2 p-3 ${CARD}`}>
        <input value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} placeholder="Nombre" className={INPUT} />
        <select value={nuevo.rol} onChange={(e) => setNuevo({ ...nuevo, rol: e.target.value })} className={INPUT}>
          <option value="mesero">Mesero</option><option value="cocina">Cocina</option>
        </select>
        {esSuper && (
          <select value={nuevo.sucursalId} onChange={(e) => setNuevo({ ...nuevo, sucursalId: e.target.value })} className={INPUT}>
            {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        )}
        <input value={nuevo.pin} onChange={(e) => setNuevo({ ...nuevo, pin: e.target.value })} placeholder="PIN (6 díg.)" inputMode="numeric" className={`w-28 tabular-nums ${INPUT}`} />
        <button type="button" onClick={() => void crear()} className={BTN}>Crear</button>
        {error && <span className="font-bold text-rojo-400">{error}</span>}
      </div>
      <table className="w-full text-sm">
        <tbody>
          {usuarios.map((u) => (
            <tr key={u.id} className="border-b border-carbon-800">
              <td className="py-2 font-bold">{u.nombre}</td>
              <td className="capitalize text-piedra-500">{u.rol}</td>
              {esSuper && <td className="text-piedra-500">{u.sucursalId ? nombreSuc.get(u.sucursalId) : '—'}</td>}
              <td className={u.activo ? 'text-ok' : 'text-piedra-500'}>{u.activo ? 'activo' : 'baja'}</td>
              <td className="flex items-center justify-end gap-2 py-1">
                {u.activo && (u.rol === 'mesero' || u.rol === 'cocina') && (
                  <>
                    <input
                      value={pinEdit[u.id] ?? ''}
                      onChange={(e) => setPinEdit((s) => ({ ...s, [u.id]: e.target.value }))}
                      placeholder="Nuevo PIN"
                      inputMode="numeric"
                      className={`w-24 tabular-nums ${INPUT}`}
                    />
                    <button
                      type="button"
                      disabled={(pinEdit[u.id] ?? '').length < 4}
                      onClick={() => void reasignarPin(u.id)}
                      className="font-bold text-oro-400 hover:text-oro-300 disabled:text-piedra-600"
                    >
                      PIN
                    </button>
                    <button type="button" onClick={() => void admin.bajaUsuario(token, u.id).then(cargar)} className="font-bold text-rojo-400 hover:text-rojo-300">Dar de baja</button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PanelGastos({ token, desde, hasta, sucursal, sucursales, esSuper }: RangoProps & { sucursales: Sucursal[]; esSuper: boolean }) {
  const [gastos, setGastos] = useState<{ id: string; categoria: string; concepto: string; monto: number; fecha: string }[]>([]);
  const [nuevo, setNuevo] = useState({ categoria: 'insumo', concepto: '', monto: '', sucursalId: '' });
  const cargar = useCallback(async () => setGastos(await admin.gastos(token, desde, hasta, sucursal)), [token, desde, hasta, sucursal]);
  useEffect(() => { void cargar(); }, [cargar]);
  useEffect(() => setNuevo((n) => ({ ...n, sucursalId: sucursales[0]?.id ?? '' })), [sucursales]);

  async function crear() {
    if (!nuevo.concepto || !nuevo.monto) return;
    await admin.crearGasto(token, { categoria: nuevo.categoria, concepto: nuevo.concepto, monto: Math.round(Number(nuevo.monto) * 100), fecha: hasta, ...(esSuper ? { sucursalId: nuevo.sucursalId } : {}) });
    setNuevo((n) => ({ ...n, concepto: '', monto: '' }));
    await cargar();
  }

  return (
    <div>
      <h2 className="mb-3 text-h2 font-bold text-piedra-100">Gastos</h2>
      <div className={`mb-4 flex flex-wrap items-end gap-2 p-3 ${CARD}`}>
        <select value={nuevo.categoria} onChange={(e) => setNuevo({ ...nuevo, categoria: e.target.value })} className={INPUT}>
          {['insumo', 'servicio', 'sueldo', 'renta', 'otro'].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input value={nuevo.concepto} onChange={(e) => setNuevo({ ...nuevo, concepto: e.target.value })} placeholder="Concepto" className={INPUT} />
        <input value={nuevo.monto} onChange={(e) => setNuevo({ ...nuevo, monto: e.target.value })} placeholder="Monto $" type="number" className={`w-28 tabular-nums ${INPUT}`} />
        {esSuper && (
          <select value={nuevo.sucursalId} onChange={(e) => setNuevo({ ...nuevo, sucursalId: e.target.value })} className={INPUT}>
            {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        )}
        <button type="button" onClick={() => void crear()} className={BTN}>Registrar</button>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {gastos.map((g) => (
            <tr key={g.id} className="border-b border-carbon-800">
              <td className="py-2 capitalize text-piedra-500">{g.categoria}</td>
              <td>{g.concepto}</td>
              <td className="tabular-nums">{formatearMoneda(g.monto)}</td>
              <td className="text-piedra-500">{g.fecha}</td>
            </tr>
          ))}
          {gastos.length === 0 && <tr><td colSpan={4} className="py-3 text-piedra-500">Sin gastos en el periodo</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// Alta/baja de sucursales (RF-B). La clave se muestra grande: es lo que el
// mesero escribe para entrar. onCambio refresca la lista global (para que las
// nuevas aparezcan al asignar admin/usuarios/gastos).
function PanelSucursales({ token, sucursal, onCambio }: { token: string; sucursal: string; onCambio: () => void }) {
  const [filas, setFilas] = useState<Sucursal[]>([]);
  const [nuevo, setNuevo] = useState({ nombre: '', direccion: '' });
  const [error, setError] = useState<string | null>(null);
  const [claveEdit, setClaveEdit] = useState<Record<string, string>>({});
  const cargar = useCallback(async () => setFilas(await admin.sucursales(token)), [token]);
  useEffect(() => { void cargar(); }, [cargar]);

  // El filtro del topbar acota la vista a la sucursal elegida (o todas).
  const visibles = sucursal ? filas.filter((s) => s.id === sucursal) : filas;

  async function crear() {
    setError(null);
    if (!nuevo.nombre.trim()) return;
    try {
      await admin.crearSucursal(token, { nombre: nuevo.nombre, ...(nuevo.direccion ? { direccion: nuevo.direccion } : {}) });
      setNuevo({ nombre: '', direccion: '' });
      await cargar();
      onCambio();
    } catch { setError('No se pudo crear'); }
  }

  async function guardarClave(id: string) {
    const nueva = (claveEdit[id] ?? '').trim();
    if (nueva.length < 3) return;
    try {
      await admin.editarSucursal(token, id, { clave: nueva });
      setClaveEdit((c) => { const n = { ...c }; delete n[id]; return n; });
      await cargar();
      onCambio();
    } catch { setError('Esa clave ya está en uso.'); }
  }

  return (
    <div>
      <h2 className="mb-3 text-h2 font-bold text-piedra-100">Sucursales</h2>
      <div className={`mb-5 flex flex-wrap items-end gap-2 p-3 ${CARD}`}>
        <input value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} placeholder="Nombre (p. ej. Sur)" className={INPUT} />
        <input value={nuevo.direccion} onChange={(e) => setNuevo({ ...nuevo, direccion: e.target.value })} placeholder="Dirección" className={`w-64 ${INPUT}`} />
        <button type="button" onClick={() => void crear()} className={BTN}>Agregar sucursal</button>
        {error && <span className="font-bold text-rojo-400">{error}</span>}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {visibles.map((s) => (
          <div key={s.id} className={`p-4 ${CARD}`}>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-h2 font-bold text-oro-300">{s.nombre}</span>
              <span className={`text-xs font-bold ${s.activo ? 'text-ok' : 'text-piedra-500'}`}>{s.activo ? 'activa' : 'inactiva'}</span>
            </div>
            <p className="mb-2 text-sm text-piedra-400">
              Clave: <span className="text-lg font-bold tracking-widest text-oro-400">{s.clave}</span>
            </p>
            {/* Cambiar la clave (seguridad): quien tenga la vieja deja de entrar. */}
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <input
                value={claveEdit[s.id] ?? ''}
                onChange={(e) => setClaveEdit((c) => ({ ...c, [s.id]: e.target.value.toUpperCase() }))}
                placeholder="Nueva clave"
                className={`w-40 tracking-widest ${INPUT}`}
              />
              <button type="button" onClick={() => void guardarClave(s.id)} disabled={(claveEdit[s.id] ?? '').trim().length < 3} className="text-sm font-bold text-oro-400 hover:text-oro-300 disabled:text-piedra-600">
                Cambiar clave
              </button>
            </div>
            <p className="mb-3 text-sm text-piedra-500">{s.direccion || 'Sin dirección'}</p>
            <button type="button" onClick={() => void admin.editarSucursal(token, s.id, { activo: !s.activo }).then(() => { void cargar(); onCambio(); })} className="text-sm font-bold text-piedra-400 hover:text-piedra-200">
              {s.activo ? 'Desactivar' : 'Reactivar'}
            </button>
          </div>
        ))}
        {visibles.length === 0 && <p className="text-piedra-500">Sin sucursales.</p>}
      </div>
    </div>
  );
}

function PanelAdmins({ token, sucursal, sucursales }: { token: string; sucursal: string; sucursales: Sucursal[] }) {
  const [usuarios, setUsuarios] = useState<UsuarioAdmin[]>([]);
  const [nuevo, setNuevo] = useState({ nombre: '', email: '', password: '', sucursalId: '' });
  const [error, setError] = useState<string | null>(null);
  const claveSuc = useMemo(() => new Map(sucursales.map((s) => [s.id, s])), [sucursales]);
  const cargar = useCallback(async () => setUsuarios(await admin.usuarios(token, sucursal)), [token, sucursal]);
  useEffect(() => { void cargar(); }, [cargar]);
  useEffect(() => setNuevo((n) => ({ ...n, sucursalId: sucursal || sucursales[0]?.id || '' })), [sucursales, sucursal]);
  const admins = usuarios.filter((u) => u.rol === 'administrador');

  async function crear() {
    setError(null);
    if (!nuevo.nombre || !nuevo.email || !nuevo.password || !nuevo.sucursalId) return;
    try {
      await admin.crearAdmin(token, nuevo);
      setNuevo((n) => ({ ...n, nombre: '', email: '', password: '' }));
      await cargar();
    } catch { setError('Contraseña débil o correo repetido'); }
  }

  return (
    <div>
      <h2 className="mb-1 text-h2 font-bold text-piedra-100">Administradores</h2>
      <p className="mb-3 text-sm text-piedra-500">Cada gerente ve y gestiona solo su sucursal.</p>
      <div className={`mb-5 flex flex-wrap items-end gap-2 p-3 ${CARD}`}>
        <input value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} placeholder="Nombre" className={INPUT} />
        <input value={nuevo.email} onChange={(e) => setNuevo({ ...nuevo, email: e.target.value })} placeholder="correo@negocio.mx" type="email" className={`w-56 ${INPUT}`} />
        <input value={nuevo.password} onChange={(e) => setNuevo({ ...nuevo, password: e.target.value })} placeholder="Contraseña" type="password" className={INPUT} />
        <select value={nuevo.sucursalId} onChange={(e) => setNuevo({ ...nuevo, sucursalId: e.target.value })} className={INPUT}>
          {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
        <button type="button" onClick={() => void crear()} className={BTN}>Crear administrador</button>
        {error && <span className="font-bold text-rojo-400">{error}</span>}
      </div>
      <table className="w-full text-sm">
        <tbody>
          {admins.map((u) => {
            const s = u.sucursalId ? claveSuc.get(u.sucursalId) : undefined;
            return (
              <tr key={u.id} className="border-b border-carbon-800">
                <td className="py-2 font-bold">{u.nombre}</td>
                <td className="text-oro-300">{s?.nombre ?? '—'}</td>
                <td className="text-piedra-500">clave <span className="font-bold tracking-widest text-oro-400">{s?.clave ?? '—'}</span></td>
                <td className={u.activo ? 'text-ok' : 'text-piedra-500'}>{u.activo ? 'activo' : 'baja'}</td>
                <td className="py-1 text-right">
                  {u.activo && <button type="button" onClick={() => void admin.bajaUsuario(token, u.id).then(cargar)} className="font-bold text-rojo-400 hover:text-rojo-300">Dar de baja</button>}
                </td>
              </tr>
            );
          })}
          {admins.length === 0 && <tr><td className="py-3 text-piedra-500">Sin administradores.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// Alertas de tablets sin sync como toasts que se borran a los 5 s (RNF-O-5).
function AlertasSync({ token }: { token: string }) {
  const [toasts, setToasts] = useState<{ key: number; texto: string }[]>([]);
  const [, setAvisadas] = useState<Set<string>>(new Set());

  useEffect(() => {
    const cargar = async () => {
      let disp: { id: string; nombre: string; activo: boolean; minutosSinSync: number | null }[] = [];
      try {
        disp = await admin.dispositivos(token);
      } catch {
        return;
      }
      const rezagadas = disp.filter((d) => d.activo && d.minutosSinSync !== null && d.minutosSinSync >= 10);
      setAvisadas((prev) => {
        const vistos = new Set(rezagadas.map((d) => d.id));
        const nuevos = rezagadas.filter((d) => !prev.has(d.id));
        for (const d of nuevos) {
          const key = Date.now() + Math.random();
          setToasts((t) => [...t, { key, texto: `⚠ ${d.nombre} · ${d.minutosSinSync} min sin sync` }]);
          setTimeout(() => setToasts((t) => t.filter((x) => x.key !== key)), 5000);
        }
        return vistos; // olvida las que ya se pusieron al día → vuelve a avisar si recaen
      });
    };
    void cargar();
    const t = setInterval(cargar, 30_000);
    return () => clearInterval(t);
  }, [token]);

  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.key} className="rounded-md border border-rojo-600 bg-carbon-800 px-4 py-2 font-bold text-rojo-400 shadow-lg">
          {t.texto}
        </div>
      ))}
    </div>
  );
}

function Kpi({ titulo, valor, alerta }: { titulo: string; valor: string; alerta?: boolean }) {
  return (
    <div className={`p-4 ${CARD}`}>
      <p className={`text-2xl font-bold tabular-nums ${alerta ? 'text-rojo-400' : 'text-oro-300'}`}>{valor}</p>
      <p className="text-sm text-piedra-500">{titulo}</p>
    </div>
  );
}
