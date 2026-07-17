// Captura del mesero (09 §4): lista con stepper en línea, vertical 400×670.
// Sirve para una comanda nueva y para agregar a una ya enviada (RF-E-7, modo
// `adicion`). Los productos con cantidad > 0 se anclan arriba.
import { useMemo, useState } from 'react';
import { formatearMoneda } from '@lena/shared';
import type { Domicilio as DatosDomicilio, TipoServicio } from '@lena/shared';
import { Boton } from '../ui/Boton';
import { EstadoSync } from '../ui/EstadoSync';
import { Stepper } from '../ui/Stepper';
import { rolEvento } from '../dominio/api';
import type { Catalogo, DatosSesion, ProductoCat } from '../dominio/api';
import { hlcMaximo } from '../dominio/cocina';
import { asignarVoceo, configDispositivo } from '../dominio/dispositivo';
import { ConstructorEventos } from '../dominio/eventos';
import type { LineaBorrador } from '../dominio/eventos';
import type { Motor } from '../dominio/motor';
import { Domicilio } from './Domicilio';

interface Props {
  sesion: DatosSesion;
  catalogo: Catalogo;
  motor: Motor;
  enLinea: boolean;
  pendientes: number;
  onSincronizar: () => void;
  onVerComandas: () => void;
  onSalir: () => void;
  // Modo adición (RF-E-7): agrega a una comanda existente en vez de crear una.
  adicion?: { comandaId: string; etiqueta: string };
  onListo?: () => void;
}

export function Captura({
  sesion,
  catalogo,
  motor,
  enLinea,
  pendientes,
  onSincronizar,
  onVerComandas,
  onSalir,
  adicion,
  onListo,
}: Props) {
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

  const [tipo, setTipo] = useState<TipoServicio>('para_llevar');
  const [mesaId, setMesaId] = useState<string | null>(null);
  const [domicilio, setDomicilio] = useState<DatosDomicilio | null>(null);
  const [mostrarDomicilio, setMostrarDomicilio] = useState(false);
  const [borrador, setBorrador] = useState<Map<string, number>>(new Map());
  // Notas por producto (RF-E-9): "sin cebolla", etc. Van a cocina en el evento.
  const [notas, setNotas] = useState<Record<string, string>>({});
  const [catActiva, setCatActiva] = useState(catalogo.categorias[0]?.id ?? '');
  const [enviando, setEnviando] = useState(false);
  const [confirmacion, setConfirmacion] = useState<{ voceo: string } | null>(null);

  const porId = useMemo(() => new Map(catalogo.productos.map((p) => [p.id, p])), [catalogo.productos]);

  const total = useMemo(() => {
    let c = 0;
    for (const [id, cant] of borrador) c += (porId.get(id)?.precio ?? 0) * cant;
    return c;
  }, [borrador, porId]);

  const cantidadTotal = [...borrador.values()].reduce((a, b) => a + b, 0);

  function elegirTipo(t: TipoServicio) {
    setTipo(t);
    setMesaId(null);
    if (t === 'domicilio') setMostrarDomicilio(true);
    else setDomicilio(null);
  }

  function cambiar(id: string, nueva: number) {
    setBorrador((prev) => {
      const m = new Map(prev);
      if (nueva <= 0) m.delete(id);
      else m.set(id, nueva);
      return m;
    });
    if (nueva <= 0) setNotas((n) => { const c = { ...n }; delete c[id]; return c; });
  }

  // Productos ya elegidos (de cualquier categoría), anclados arriba.
  const pedidos = useMemo(() => catalogo.productos.filter((p) => borrador.has(p.id)), [catalogo.productos, borrador]);
  // El resto de la categoría activa, agrupado por subcategoría (RF-D-6).
  const porSub = useMemo(() => {
    const grupos = new Map<string, ProductoCat[]>();
    for (const p of catalogo.productos) {
      if (borrador.has(p.id) || p.categoriaId !== catActiva) continue;
      const sub = p.subcategoria || '';
      if (!grupos.has(sub)) grupos.set(sub, []);
      (grupos.get(sub) as ProductoCat[]).push(p);
    }
    return [...grupos.entries()];
  }, [catalogo.productos, borrador, catActiva]);

  async function enviar() {
    if (cantidadTotal === 0 || enviando) return;
    if (!adicion && tipo === 'mesa' && !mesaId) return;
    if (!adicion && tipo === 'domicilio' && !domicilio) return;
    setEnviando(true);
    try {
      const lineas: LineaBorrador[] = [...borrador].map(([id, cantidad]) => {
        const p = porId.get(id) as ProductoCat;
        const nota = notas[id]?.trim();
        return { productoId: id, nombreProducto: p.nombre, precioUnitario: p.precio, cantidad, ...(nota ? { notas: nota } : {}) };
      });

      if (adicion) {
        // La adición debe ir DESPUÉS de todo lo que la comanda ya tiene: el
        // reloj de este constructor es nuevo y no ha visto esos eventos (ADR-003).
        constructor.observar(hlcMaximo(await motor.almacen.log(), adicion.comandaId));
        const eventos = constructor.agregarLineas(adicion.comandaId, lineas);
        for (const e of eventos) await motor.sync.crear(e);
        onSincronizar();
        onListo?.();
        return;
      }

      const { comandaId, eventos } = constructor.armarComanda(tipo, lineas, {
        ...(mesaId ? { mesaId } : {}),
        ...(domicilio ? { domicilio } : {}),
      });
      for (const e of eventos) await motor.sync.crear(e);
      const voceo = asignarVoceo(comandaId, disp.letra);
      setConfirmacion({ voceo });
      setBorrador(new Map());
      setNotas({});
      setDomicilio(null);
      setTipo('para_llevar');
      onSincronizar();
    } finally {
      setEnviando(false);
    }
  }

  if (mostrarDomicilio) {
    return (
      <Domicilio
        onListo={(d) => {
          setDomicilio(d);
          setMostrarDomicilio(false);
        }}
        onCancelar={() => {
          setMostrarDomicilio(false);
          setTipo('para_llevar');
        }}
      />
    );
  }

  if (confirmacion) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 p-6 text-center">
        <p className="text-h2 uppercase tracking-wide text-piedra-400">
          {tipo === 'para_llevar' ? 'Para llevar' : tipo === 'mesa' ? 'En mesa' : 'Domicilio'}
        </p>
        {/* El ID que se vocea: nunca cambia al sincronizar (09 §4.2). */}
        <p className="text-[72px] font-bold leading-none text-oro-400 tabular-nums">{confirmacion.voceo}</p>
        <p className="text-piedra-400">Comanda enviada a cocina</p>
        <Boton onClick={() => setConfirmacion(null)} className="mt-4 h-14 w-full max-w-xs">
          Nueva comanda
        </Boton>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-carbon-700 px-4 py-2">
        {adicion ? (
          <button type="button" onClick={onListo} className="font-semibold text-piedra-300">
            ‹ Agregar a {adicion.etiqueta}
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <select
              value={tipo}
              onChange={(e) => elegirTipo(e.target.value as TipoServicio)}
              className="rounded-md bg-carbon-800 px-2 py-1 font-semibold"
            >
              <option value="para_llevar">Para llevar</option>
              <option value="mesa">Mesa</option>
              <option value="domicilio">Domicilio</option>
            </select>
            {tipo === 'mesa' && (
              <select
                value={mesaId ?? ''}
                onChange={(e) => setMesaId(e.target.value || null)}
                className="rounded-md bg-carbon-800 px-2 py-1"
              >
                <option value="">Mesa…</option>
                {catalogo.mesas.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nombre}
                  </option>
                ))}
              </select>
            )}
            {tipo === 'domicilio' && domicilio && (
              <button type="button" onClick={() => setMostrarDomicilio(true)} className="text-sm text-info underline">
                {domicilio.telefono}
              </button>
            )}
          </div>
        )}
        <div className="flex items-center gap-3">
          <button type="button" onClick={onVerComandas} aria-label="ver comandas" className="text-xl">
            ☰
          </button>
          <EstadoSync enLinea={enLinea} pendientes={pendientes} />
          <button
            type="button"
            onClick={() => {
              if (confirm('¿Cerrar sesión y cambiar de usuario?')) onSalir();
            }}
            aria-label="cerrar sesión"
            className="rounded-md px-2 py-1 text-sm font-semibold text-piedra-400"
          >
            Salir
          </button>
        </div>
      </header>

      <nav className="flex gap-2 overflow-x-auto border-b border-carbon-700 px-4 py-2">
        {catalogo.categorias.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCatActiva(c.id)}
            className={`whitespace-nowrap rounded-md px-3 py-1 font-semibold ${c.id === catActiva ? 'bg-carbon-800 text-oro-300' : 'text-piedra-400'}`}
          >
            {c.nombre}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto">
        {/* Tu comanda: lo ya elegido, con campo de nota por producto. */}
        {pedidos.length > 0 && (
          <ul className="border-b-4 border-carbon-700 bg-carbon-900">
            {pedidos.map((p) => (
              <li key={p.id} className="border-b border-carbon-800 px-4 py-2 last:border-0">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-body-lg font-medium">{p.nombre}</span>
                    <span className="ml-2 text-piedra-400 tabular-nums">{formatearMoneda(p.precio)}</span>
                  </div>
                  <Stepper cantidad={borrador.get(p.id) ?? 0} onCambio={(n) => cambiar(p.id, n)} />
                </div>
                <input
                  value={notas[p.id] ?? ''}
                  onChange={(e) => setNotas((n) => ({ ...n, [p.id]: e.target.value }))}
                  placeholder="Nota para cocina (ej. sin cebolla)"
                  maxLength={280}
                  className="mt-1 w-full rounded-md border border-carbon-600 bg-carbon-800 px-2 py-1 text-sm text-piedra-100 placeholder-piedra-500"
                />
              </li>
            ))}
          </ul>
        )}

        {/* Catálogo de la categoría activa, agrupado por subcategoría. */}
        <ul>
          {porSub.map(([sub, prods]) => (
            <li key={sub || 'sin'}>
              {sub && (
                <p className="bg-carbon-900 px-4 py-1 text-xs font-bold uppercase tracking-wide text-piedra-500">{sub}</p>
              )}
              <ul>
                {prods.map((p) => (
                  <li key={p.id} className="flex items-center justify-between border-b border-carbon-800 px-4 py-2">
                    <div className={p.disponible ? '' : 'text-piedra-400 line-through'}>
                      <span className="text-body-lg font-medium">{p.nombre}</span>
                      <span className="ml-2 text-piedra-400 tabular-nums">{formatearMoneda(p.precio)}</span>
                    </div>
                    {p.disponible ? (
                      <Stepper cantidad={borrador.get(p.id) ?? 0} onCambio={(n) => cambiar(p.id, n)} />
                    ) : (
                      <span className="text-sm text-piedra-400">NO DISPONIBLE</span>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>

      <footer className="border-t border-carbon-700 p-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-piedra-400">
            {cantidadTotal} {cantidadTotal === 1 ? 'producto' : 'productos'}
          </span>
          <span className="text-h2 font-bold tabular-nums">{formatearMoneda(total)}</span>
        </div>
        <Boton
          onClick={enviar}
          disabled={cantidadTotal === 0 || enviando || (!adicion && tipo === 'mesa' && !mesaId)}
          className="h-16 w-full text-lg"
        >
          {enviando ? 'Enviando…' : adicion ? 'AGREGAR A COCINA →' : 'ENVIAR A COCINA →'}
        </Boton>
      </footer>
    </div>
  );
}
