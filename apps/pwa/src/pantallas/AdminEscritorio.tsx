// Escritorio del administrador (09 §7). Denso, escaneable, tema claro. Reúne
// los reportes del servidor: resumen, merma/cancelaciones por mesero (la
// mitigación de T1, §7.1), canceladas y cortes. Alcance global (RF-C-4).
import { useEffect, useMemo, useState } from 'react';
import { formatearMoneda } from '@lena/shared';
import { admin, exportarCsv, obtenerCatalogo } from '../dominio/api';
import type { Cancelada, Corte, MasVendido, ProductoCat, ReporteMerma, Resumen, UsuarioAdmin } from '../dominio/api';

type Seccion = 'resumen' | 'merma' | 'canceladas' | 'cortes' | 'productos' | 'usuarios' | 'gastos';

const SECCIONES: { id: Seccion; nombre: string; alerta?: boolean }[] = [
  { id: 'resumen', nombre: 'Resumen' },
  { id: 'merma', nombre: 'Merma y canceladas', alerta: true },
  { id: 'canceladas', nombre: 'Canceladas' },
  { id: 'cortes', nombre: 'Cortes' },
  { id: 'productos', nombre: 'Productos' },
  { id: 'usuarios', nombre: 'Usuarios' },
  { id: 'gastos', nombre: 'Gastos' },
];

export function AdminEscritorio({ token, onSalir }: { token: string; onSalir: () => void }) {
  const [seccion, setSeccion] = useState<Seccion>('resumen');
  const hoy = useMemo(
    () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date()),
    [],
  );
  const [desde, setDesde] = useState(hoy);
  const [hasta, setHasta] = useState(hoy);

  return (
    <div className="flex h-full">
      {/* Barra lateral */}
      <aside className="w-48 shrink-0 border-r border-piedra-200 bg-piedra-100 p-3">
        <h1 className="mb-4 text-h2 font-bold text-brasa-700">🔥 Leña</h1>
        <nav className="flex flex-col gap-1">
          {SECCIONES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSeccion(s.id)}
              className={`rounded-md px-3 py-2 text-left text-sm font-medium ${
                seccion === s.id ? 'bg-white text-brasa-700 shadow-sm' : 'text-piedra-600 hover:bg-white/60'
              }`}
            >
              {s.nombre} {s.alerta && <span className="text-error">⚠</span>}
            </button>
          ))}
        </nav>
        <EstadoDispositivos token={token} />

        <button type="button" onClick={onSalir} className="mt-6 text-sm text-piedra-500">
          ‹ Salir
        </button>
      </aside>

      {/* Contenido */}
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mb-4 flex items-center gap-2">
          <input
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
            className="rounded-md border border-piedra-300 px-2 py-1"
          />
          <span className="text-piedra-400">→</span>
          <input
            type="date"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
            className="rounded-md border border-piedra-300 px-2 py-1"
          />
        </div>

        {seccion === 'resumen' && <PanelResumen token={token} desde={desde} hasta={hasta} />}
        {seccion === 'merma' && <PanelMerma token={token} desde={desde} hasta={hasta} />}
        {seccion === 'canceladas' && <PanelCanceladas token={token} desde={desde} hasta={hasta} />}
        {seccion === 'cortes' && <PanelCortes token={token} desde={desde} hasta={hasta} />}
        {seccion === 'productos' && <PanelProductos token={token} />}
        {seccion === 'usuarios' && <PanelUsuarios token={token} />}
        {seccion === 'gastos' && <PanelGastos token={token} desde={desde} hasta={hasta} />}
      </main>
    </div>
  );
}

interface RangoProps {
  token: string;
  desde: string;
  hasta: string;
}

function PanelResumen({ token, desde, hasta }: RangoProps) {
  const [r, setR] = useState<Resumen | null>(null);
  const [top, setTop] = useState<MasVendido[]>([]);
  const [horas, setHoras] = useState<{ hora: number; ventas: number }[]>([]);
  useEffect(() => {
    admin
      .resumen(token, desde, hasta)
      .then(setR)
      .catch(() => setR(null));
    admin
      .masVendidos(token, desde, hasta)
      .then(setTop)
      .catch(() => setTop([]));
    admin
      .ventasPorHora(token, desde, hasta)
      .then(setHoras)
      .catch(() => setHoras([]));
  }, [token, desde, hasta]);

  const maxHora = Math.max(1, ...horas.map((h) => h.ventas));

  return (
    <div>
      <div className="grid grid-cols-4 gap-3">
        <Kpi titulo="Ventas" valor={formatearMoneda(r?.ventas ?? 0)} />
        <Kpi titulo="Comandas" valor={String(r?.comandas ?? 0)} />
        <Kpi titulo="Ticket promedio" valor={formatearMoneda(r?.ticket ?? 0)} />
        <Kpi titulo="Merma" valor={formatearMoneda(r?.merma ?? 0)} alerta />
      </div>

      <h3 className="mb-2 mt-6 text-label font-semibold uppercase text-piedra-500">Ventas por hora</h3>
      <div className="flex h-32 items-end gap-1 rounded-lg border border-piedra-200 p-3">
        {horas.length === 0 && <p className="m-auto text-piedra-400">Sin ventas</p>}
        {horas.map((h) => (
          <div key={h.hora} className="flex flex-1 flex-col items-center justify-end">
            <div
              className="w-full rounded-t bg-brasa-500"
              style={{ height: `${(h.ventas / maxHora) * 100}%` }}
              title={formatearMoneda(h.ventas)}
            />
            <span className="mt-1 text-[10px] text-piedra-500 tabular-nums">{h.hora}</span>
          </div>
        ))}
      </div>

      <h3 className="mb-2 mt-6 text-label font-semibold uppercase text-piedra-500">Más vendidos</h3>
      <ol className="rounded-lg border border-piedra-200">
        {top.slice(0, 5).map((p, i) => (
          <li key={p.nombre} className="flex justify-between border-b border-piedra-100 px-3 py-2 last:border-0">
            <span>
              {i + 1}. {p.nombre}
            </span>
            <span className="tabular-nums text-piedra-600">{p.unidades}</span>
          </li>
        ))}
        {top.length === 0 && <li className="px-3 py-2 text-piedra-400">Sin datos</li>}
      </ol>
    </div>
  );
}

function PanelMerma({ token, desde, hasta }: RangoProps) {
  const [r, setR] = useState<ReporteMerma | null>(null);
  useEffect(() => {
    admin
      .merma(token, desde, hasta)
      .then(setR)
      .catch(() => setR(null));
  }, [token, desde, hasta]);

  return (
    <div>
      <h2 className="mb-3 text-h2 font-semibold">Merma y cancelaciones</h2>
      <p className="mb-4 text-piedra-600">
        Merma total: <span className="font-bold text-error">{formatearMoneda(r?.total ?? 0)}</span>
      </p>

      <h3 className="mb-2 text-label font-semibold uppercase text-piedra-500">Por mesero</h3>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-piedra-300 text-left text-piedra-500">
            <th className="py-2">Mesero</th>
            <th>Comandas</th>
            <th>Canceladas</th>
            <th>Tasa</th>
            <th>Merma</th>
            <th>vs. equipo</th>
          </tr>
        </thead>
        <tbody>
          {(r?.meseros ?? []).map((m) => {
            const sospechoso = m.vsEquipo >= 2;
            return (
              <tr key={m.id} className={`border-b border-piedra-100 ${sospechoso ? 'bg-[#FEF2F2]' : ''}`}>
                <td className="py-2 font-medium">{m.nombre}</td>
                <td className="tabular-nums">{m.comandas}</td>
                <td className="tabular-nums">{m.canceladas}</td>
                <td className="tabular-nums">{(m.tasa * 100).toFixed(1)}%</td>
                <td className="tabular-nums">{formatearMoneda(m.merma)}</td>
                <td className={`tabular-nums font-semibold ${sospechoso ? 'text-error' : 'text-piedra-400'}`}>
                  {sospechoso ? `⚠ ${m.vsEquipo.toFixed(1)}×` : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {/* La regla que hace visible el patrón que 62 eventos sueltos esconden. */}
      {(r?.meseros ?? []).some((m) => m.vsEquipo >= 2) && (
        <p className="mt-3 rounded-md bg-[#FEF2F2] p-2 text-error">
          ⚠️ Un mesero cancela mucho más que el promedio. Revisar (control antifraude T1).
        </p>
      )}
    </div>
  );
}

function PanelCanceladas({ token, desde, hasta }: RangoProps) {
  const [filas, setFilas] = useState<Cancelada[]>([]);
  useEffect(() => {
    admin
      .canceladas(token, desde, hasta)
      .then(setFilas)
      .catch(() => setFilas([]));
  }, [token, desde, hasta]);
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-h2 font-semibold">Comandas canceladas</h2>
        <button
          type="button"
          onClick={() => void exportarCsv(token, 'canceladas', desde, hasta)}
          className="text-sm text-info underline"
        >
          Exportar CSV
        </button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-piedra-300 text-left text-piedra-500">
            <th className="py-2">Folio</th>
            <th>Mesero</th>
            <th>Motivo</th>
            <th>Costo mermado</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((c) => (
            <tr key={c.id} className="border-b border-piedra-100">
              <td className="py-2 tabular-nums">{c.folio ?? '—'}</td>
              <td>{c.mesero}</td>
              <td className="text-piedra-600">{c.motivo}</td>
              <td className="tabular-nums text-error">{formatearMoneda(c.costoMermado)}</td>
            </tr>
          ))}
          {filas.length === 0 && (
            <tr>
              <td colSpan={4} className="py-3 text-piedra-400">
                Sin cancelaciones en el periodo
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function PanelCortes({ token, desde, hasta }: RangoProps) {
  const [filas, setFilas] = useState<Corte[]>([]);
  useEffect(() => {
    admin
      .cortes(token, desde, hasta)
      .then(setFilas)
      .catch(() => setFilas([]));
  }, [token, desde, hasta]);
  return (
    <div>
      <h2 className="mb-3 text-h2 font-semibold">Historial de cortes</h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-piedra-300 text-left text-piedra-500">
            <th className="py-2">Cerrado</th>
            <th>Esperado</th>
            <th>Contado</th>
            <th>Diferencia</th>
            <th>Tarjeta</th>
            <th>Transfer.</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((c) => (
            <tr key={c.id} className="border-b border-piedra-100">
              <td className="py-2 text-piedra-600">{c.cerradoAt?.slice(0, 16).replace('T', ' ')}</td>
              <td className="tabular-nums">{formatearMoneda(c.esperado)}</td>
              <td className="tabular-nums">{formatearMoneda(c.contado)}</td>
              <td className={`tabular-nums ${c.diferencia !== 0 ? 'font-semibold text-error' : 'text-ok'}`}>
                {formatearMoneda(c.diferencia)}
              </td>
              <td className="tabular-nums">{formatearMoneda(c.tarjeta)}</td>
              <td className="tabular-nums">{formatearMoneda(c.transferencia)}</td>
            </tr>
          ))}
          {filas.length === 0 && (
            <tr>
              <td colSpan={6} className="py-3 text-piedra-400">
                Sin cortes cerrados en el periodo
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function PanelProductos({ token }: { token: string }) {
  const [productos, setProductos] = useState<ProductoCat[]>([]);
  const [editando, setEditando] = useState<Record<string, string>>({});
  const [historial, setHistorial] = useState<{
    id: string;
    filas: { precioAnterior: string; precioNuevo: string; createdAt: string }[];
  } | null>(null);

  async function cargar() {
    const cat = await obtenerCatalogo(token);
    setProductos(cat.productos);
  }
  useEffect(() => {
    void cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function guardarPrecio(id: string) {
    const pesos = Number(editando[id]);
    if (!pesos) return;
    await admin.cambiarPrecio(token, id, Math.round(pesos * 100));
    setEditando((e) => {
      const n = { ...e };
      delete n[id];
      return n;
    });
    await cargar();
  }

  return (
    <div>
      <h2 className="mb-3 text-h2 font-semibold">Productos</h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-piedra-300 text-left text-piedra-500">
            <th className="py-2">Producto</th>
            <th>Precio</th>
            <th>Nuevo precio</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {productos.map((p) => (
            <tr key={p.id} className="border-b border-piedra-100">
              <td className="py-2 font-medium">{p.nombre}</td>
              <td className="tabular-nums">{formatearMoneda(p.precio)}</td>
              <td>
                <input
                  type="number"
                  value={editando[p.id] ?? ''}
                  onChange={(e) => setEditando((s) => ({ ...s, [p.id]: e.target.value }))}
                  className="w-24 rounded-md border border-piedra-300 px-2 py-1 tabular-nums"
                  placeholder="$"
                />
              </td>
              <td className="flex gap-2 py-1">
                <button
                  type="button"
                  onClick={() => void guardarPrecio(p.id)}
                  disabled={!editando[p.id]}
                  className="text-brasa-700 disabled:text-piedra-300"
                >
                  Guardar
                </button>
                <button
                  type="button"
                  onClick={() => admin.historialPrecios(token, p.id).then((filas) => setHistorial({ id: p.id, filas }))}
                  className="text-info"
                >
                  Historial
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {historial && (
        <div className="mt-4 rounded-lg border border-piedra-200 p-3 text-sm">
          <p className="mb-1 font-semibold">Historial de precio (RF-D-4)</p>
          {historial.filas.length === 0 && <p className="text-piedra-400">Sin cambios registrados</p>}
          {historial.filas.map((h, i) => (
            <p key={i} className="tabular-nums text-piedra-600">
              {h.createdAt.slice(0, 10)}: ${h.precioAnterior} → ${h.precioNuevo}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function PanelUsuarios({ token }: { token: string }) {
  const [usuarios, setUsuarios] = useState<UsuarioAdmin[]>([]);
  const [sucursales, setSucursales] = useState<{ id: string; nombre: string }[]>([]);
  const [nuevo, setNuevo] = useState({ nombre: '', rol: 'mesero', sucursalId: '', pin: '' });
  const [error, setError] = useState<string | null>(null);

  async function cargar() {
    setUsuarios(await admin.usuarios(token));
  }
  useEffect(() => {
    void cargar();
    admin.sucursales(token).then((s) => {
      setSucursales(s);
      setNuevo((n) => ({ ...n, sucursalId: s[0]?.id ?? '' }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function crear() {
    setError(null);
    try {
      await admin.crearUsuario(token, nuevo);
      setNuevo((n) => ({ ...n, nombre: '', pin: '' }));
      await cargar();
    } catch {
      setError('PIN inválido o datos incompletos');
    }
  }

  return (
    <div>
      <h2 className="mb-3 text-h2 font-semibold">Usuarios</h2>
      <div className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-piedra-200 p-3">
        <input
          value={nuevo.nombre}
          onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
          placeholder="Nombre"
          className="rounded-md border border-piedra-300 px-2 py-1"
        />
        <select
          value={nuevo.rol}
          onChange={(e) => setNuevo({ ...nuevo, rol: e.target.value })}
          className="rounded-md border border-piedra-300 px-2 py-1"
        >
          <option value="mesero">Mesero</option>
          <option value="cocina">Cocina</option>
        </select>
        <select
          value={nuevo.sucursalId}
          onChange={(e) => setNuevo({ ...nuevo, sucursalId: e.target.value })}
          className="rounded-md border border-piedra-300 px-2 py-1"
        >
          {sucursales.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre}
            </option>
          ))}
        </select>
        <input
          value={nuevo.pin}
          onChange={(e) => setNuevo({ ...nuevo, pin: e.target.value })}
          placeholder="PIN (6 díg.)"
          inputMode="numeric"
          className="w-28 rounded-md border border-piedra-300 px-2 py-1 tabular-nums"
        />
        <button
          type="button"
          onClick={() => void crear()}
          className="rounded-md bg-brasa-700 px-3 py-1 font-semibold text-white"
        >
          Crear
        </button>
        {error && <span className="text-error">{error}</span>}
      </div>
      <table className="w-full text-sm">
        <tbody>
          {usuarios.map((u) => (
            <tr key={u.id} className="border-b border-piedra-100">
              <td className="py-2 font-medium">{u.nombre}</td>
              <td className="capitalize text-piedra-500">{u.rol}</td>
              <td className={u.activo ? 'text-ok' : 'text-piedra-400'}>{u.activo ? 'activo' : 'baja'}</td>
              <td className="py-1 text-right">
                {u.activo && u.rol !== 'administrador' && (
                  <button
                    type="button"
                    onClick={() => void admin.bajaUsuario(token, u.id).then(cargar)}
                    className="text-error"
                  >
                    Dar de baja
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PanelGastos({ token, desde, hasta }: RangoProps) {
  const [gastos, setGastos] = useState<
    { id: string; categoria: string; concepto: string; monto: number; fecha: string }[]
  >([]);
  const [sucursales, setSucursales] = useState<{ id: string; nombre: string }[]>([]);
  const [nuevo, setNuevo] = useState({ categoria: 'insumo', concepto: '', monto: '', sucursalId: '' });

  async function cargar() {
    setGastos(await admin.gastos(token, desde, hasta));
  }
  useEffect(() => {
    void cargar();
    admin.sucursales(token).then((s) => {
      setSucursales(s);
      setNuevo((n) => ({ ...n, sucursalId: s[0]?.id ?? '' }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, desde, hasta]);

  async function crear() {
    if (!nuevo.concepto || !nuevo.monto) return;
    await admin.crearGasto(token, {
      sucursalId: nuevo.sucursalId,
      categoria: nuevo.categoria,
      concepto: nuevo.concepto,
      monto: Math.round(Number(nuevo.monto) * 100),
      fecha: hasta,
    });
    setNuevo((n) => ({ ...n, concepto: '', monto: '' }));
    await cargar();
  }

  return (
    <div>
      <h2 className="mb-3 text-h2 font-semibold">Gastos</h2>
      <div className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-piedra-200 p-3">
        <select
          value={nuevo.categoria}
          onChange={(e) => setNuevo({ ...nuevo, categoria: e.target.value })}
          className="rounded-md border border-piedra-300 px-2 py-1"
        >
          {['insumo', 'servicio', 'sueldo', 'renta', 'otro'].map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          value={nuevo.concepto}
          onChange={(e) => setNuevo({ ...nuevo, concepto: e.target.value })}
          placeholder="Concepto"
          className="rounded-md border border-piedra-300 px-2 py-1"
        />
        <input
          value={nuevo.monto}
          onChange={(e) => setNuevo({ ...nuevo, monto: e.target.value })}
          placeholder="Monto $"
          type="number"
          className="w-28 rounded-md border border-piedra-300 px-2 py-1 tabular-nums"
        />
        <select
          value={nuevo.sucursalId}
          onChange={(e) => setNuevo({ ...nuevo, sucursalId: e.target.value })}
          className="rounded-md border border-piedra-300 px-2 py-1"
        >
          {sucursales.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void crear()}
          className="rounded-md bg-brasa-700 px-3 py-1 font-semibold text-white"
        >
          Registrar
        </button>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {gastos.map((g) => (
            <tr key={g.id} className="border-b border-piedra-100">
              <td className="py-2 capitalize text-piedra-500">{g.categoria}</td>
              <td>{g.concepto}</td>
              <td className="tabular-nums">{formatearMoneda(g.monto)}</td>
              <td className="text-piedra-400">{g.fecha}</td>
            </tr>
          ))}
          {gastos.length === 0 && (
            <tr>
              <td colSpan={4} className="py-3 text-piedra-400">
                Sin gastos en el periodo
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// Estado de sync de las tablets (RNF-O-5): detecta la que cree sincronizar y
// no lo hace. Umbral de alerta: 10 minutos.
function EstadoDispositivos({ token }: { token: string }) {
  const [disp, setDisp] = useState<{ id: string; nombre: string; activo: boolean; minutosSinSync: number | null }[]>(
    [],
  );
  useEffect(() => {
    const cargar = () =>
      admin
        .dispositivos(token)
        .then(setDisp)
        .catch(() => setDisp([]));
    void cargar();
    const t = setInterval(cargar, 30_000);
    return () => clearInterval(t);
  }, [token]);

  const rezagadas = disp.filter((d) => d.activo && d.minutosSinSync !== null && d.minutosSinSync >= 10);
  return (
    <div className="mt-6 border-t border-piedra-200 pt-3 text-xs">
      {rezagadas.length === 0 ? (
        <p className="flex items-center gap-1 text-ok">● Sistema en línea</p>
      ) : (
        rezagadas.map((d) => (
          <p key={d.id} className="flex items-center gap-1 text-error">
            ⚠ {d.nombre} · {d.minutosSinSync} min sin sync
          </p>
        ))
      )}
    </div>
  );
}

function Kpi({ titulo, valor, alerta }: { titulo: string; valor: string; alerta?: boolean }) {
  return (
    <div className="rounded-lg border border-piedra-200 bg-white p-4">
      <p className={`text-2xl font-bold tabular-nums ${alerta ? 'text-error' : 'text-piedra-900'}`}>{valor}</p>
      <p className="text-sm text-piedra-500">{titulo}</p>
    </div>
  );
}
