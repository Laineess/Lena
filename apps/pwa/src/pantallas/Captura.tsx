// Captura del mesero (09 §4): lista con stepper en línea, vertical 400×670.
// Sirve para una comanda nueva y para agregar a una ya enviada (RF-E-7, modo
// `adicion`). Los productos con cantidad > 0 se anclan arriba.
import { useMemo, useState } from 'react';
import { formatearMoneda } from '@lena/shared';
import type { Domicilio as DatosDomicilio, TipoServicio } from '@lena/shared';
import { Boton } from '../ui/Boton';
import { EstadoSync } from '../ui/EstadoSync';
import { Stepper } from '../ui/Stepper';
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
  // Modo adición (RF-E-7): agrega a una comanda existente en vez de crear una.
  adicion?: { comandaId: string; etiqueta: string };
  onListo?: () => void;
}

export function Captura({ sesion, catalogo, motor, enLinea, pendientes, onSincronizar, onVerComandas, adicion, onListo }: Props) {
  const disp = configDispositivo();
  const constructor = useMemo(
    () =>
      new ConstructorEventos({
        sucursalId: sesion.sesion.sucursalId as string,
        actorId: sesion.sesion.usuarioId,
        dispositivoId: sesion.sesion.dispositivoId as string,
        nodo: disp.letra,
        rol: sesion.sesion.rol,
      }),
    [sesion, disp.letra],
  );

  const [tipo, setTipo] = useState<TipoServicio>('para_llevar');
  const [mesaId, setMesaId] = useState<string | null>(null);
  const [domicilio, setDomicilio] = useState<DatosDomicilio | null>(null);
  const [mostrarDomicilio, setMostrarDomicilio] = useState(false);
  const [borrador, setBorrador] = useState<Map<string, number>>(new Map());
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
  }

  const lista = useMemo(() => {
    const pedidos = catalogo.productos.filter((p) => borrador.has(p.id));
    const resto = catalogo.productos.filter((p) => !borrador.has(p.id) && p.categoriaId === catActiva);
    return [...pedidos, ...resto];
  }, [catalogo.productos, borrador, catActiva]);

  async function enviar() {
    if (cantidadTotal === 0 || enviando) return;
    if (!adicion && tipo === 'mesa' && !mesaId) return;
    if (!adicion && tipo === 'domicilio' && !domicilio) return;
    setEnviando(true);
    try {
      const lineas: LineaBorrador[] = [...borrador].map(([id, cantidad]) => {
        const p = porId.get(id) as ProductoCat;
        return { productoId: id, nombreProducto: p.nombre, precioUnitario: p.precio, cantidad };
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
        <p className="text-h2 uppercase tracking-wide text-piedra-500">
          {tipo === 'para_llevar' ? 'Para llevar' : tipo === 'mesa' ? 'En mesa' : 'Domicilio'}
        </p>
        {/* El ID que se vocea: nunca cambia al sincronizar (09 §4.2). */}
        <p className="text-[72px] font-bold leading-none text-brasa-700 tabular-nums">{confirmacion.voceo}</p>
        <p className="text-piedra-500">Comanda enviada a cocina</p>
        <Boton onClick={() => setConfirmacion(null)} className="mt-4 h-14 w-full max-w-xs">
          Nueva comanda
        </Boton>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-piedra-200 px-4 py-2">
        {adicion ? (
          <button type="button" onClick={onListo} className="font-semibold text-piedra-600">
            ‹ Agregar a {adicion.etiqueta}
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <select value={tipo} onChange={(e) => elegirTipo(e.target.value as TipoServicio)} className="rounded-md bg-piedra-100 px-2 py-1 font-semibold">
              <option value="para_llevar">Para llevar</option>
              <option value="mesa">Mesa</option>
              <option value="domicilio">Domicilio</option>
            </select>
            {tipo === 'mesa' && (
              <select value={mesaId ?? ''} onChange={(e) => setMesaId(e.target.value || null)} className="rounded-md bg-piedra-100 px-2 py-1">
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
        </div>
      </header>

      <nav className="flex gap-2 overflow-x-auto border-b border-piedra-200 px-4 py-2">
        {catalogo.categorias.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCatActiva(c.id)}
            className={`whitespace-nowrap rounded-md px-3 py-1 font-semibold ${c.id === catActiva ? 'bg-brasa-100 text-brasa-800' : 'text-piedra-500'}`}
          >
            {c.nombre}
          </button>
        ))}
      </nav>

      <ul className="flex-1 overflow-y-auto">
        {lista.map((p) => {
          const cant = borrador.get(p.id) ?? 0;
          return (
            <li key={p.id} className="flex items-center justify-between border-b border-piedra-100 px-4 py-2">
              <div className={p.disponible ? '' : 'text-piedra-400 line-through'}>
                <span className="text-body-lg font-medium">{p.nombre}</span>
                <span className="ml-2 text-piedra-500 tabular-nums">{formatearMoneda(p.precio)}</span>
              </div>
              {p.disponible ? (
                <Stepper cantidad={cant} onCambio={(n) => cambiar(p.id, n)} />
              ) : (
                <span className="text-sm text-piedra-400">NO DISPONIBLE</span>
              )}
            </li>
          );
        })}
      </ul>

      <footer className="border-t border-piedra-200 p-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-piedra-500">
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
