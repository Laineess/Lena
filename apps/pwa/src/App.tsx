import { useCallback, useEffect, useRef, useState } from 'react';
import type { Comanda } from '@lena/shared';
import { obtenerCatalogo } from './dominio/api';
import type { Catalogo, DatosSesion } from './dominio/api';
import { crearMotor, reanudar, tokenAcceso } from './dominio/motor';
import type { Motor } from './dominio/motor';
import { Captura } from './pantallas/Captura';
import { Cobro } from './pantallas/Cobro';
import { Cocina } from './pantallas/Cocina';
import { Comandas } from './pantallas/Comandas';
import { Ingreso } from './pantallas/Ingreso';
import { Turno } from './pantallas/Turno';

type Estado = 'cargando' | 'ingreso' | 'captura';
type Vista =
  | { v: 'captura' }
  | { v: 'comandas' }
  | { v: 'adicion'; comandaId: string; etiqueta: string }
  | { v: 'cobro'; comanda: Comanda }
  | { v: 'turno' };

export function App() {
  const [estado, setEstado] = useState<Estado>('cargando');
  const [sesion, setSesion] = useState<DatosSesion | null>(null);
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [enLinea, setEnLinea] = useState(navigator.onLine);
  const [pendientes, setPendientes] = useState(0);
  const [vista, setVista] = useState<Vista>({ v: 'captura' });
  const motorRef = useRef<Motor | null>(null);

  const entrar = useCallback(async (datos: DatosSesion) => {
    motorRef.current = crearMotor(datos);
    setSesion(datos);
    const cat = await obtenerCatalogo(datos.acceso);
    setCatalogo(cat);
    setEstado('captura');
  }, []);

  // Al abrir: intenta reanudar la sesión persistente (RS-A-8).
  useEffect(() => {
    reanudar().then((datos) => {
      if (datos) void entrar(datos);
      else setEstado('ingreso');
    });
  }, [entrar]);

  // Sincroniza al vuelo: al recuperar red y cada 15 s.
  const sincronizar = useCallback(async () => {
    const motor = motorRef.current;
    if (!motor) return;
    const r = await motor.sync.sincronizar();
    setEnLinea(r.ok && navigator.onLine);
    setPendientes(await motor.sync.pendientes());
  }, []);

  useEffect(() => {
    if (estado !== 'captura') return;
    const alConectar = () => setEnLinea(true);
    const alDesconectar = () => setEnLinea(false);
    window.addEventListener('online', alConectar);
    window.addEventListener('offline', alDesconectar);
    const t = setInterval(() => void sincronizar(), 15_000);
    void sincronizar();
    return () => {
      window.removeEventListener('online', alConectar);
      window.removeEventListener('offline', alDesconectar);
      clearInterval(t);
    };
  }, [estado, sincronizar]);

  if (estado === 'cargando') {
    return <div className="flex h-full items-center justify-center text-piedra-500">Cargando…</div>;
  }
  if (estado === 'ingreso' || !sesion || !catalogo) {
    return <Ingreso onIngreso={entrar} />;
  }

  const motor = motorRef.current as Motor;
  const enLineaReal = enLinea && tokenAcceso() !== null;

  // La cocina tiene su propia vista (09 §6): tarjetas, no captura.
  if (sesion.sesion.rol === 'cocina') {
    return (
      <Cocina
        sesion={sesion}
        catalogo={catalogo}
        motor={motor}
        enLinea={enLineaReal}
        onSincronizar={() => void sincronizar()}
      />
    );
  }

  if (vista.v === 'comandas') {
    return (
      <Comandas
        sesion={sesion}
        motor={motor}
        token={sesion.acceso}
        onCobrar={(comanda) => setVista({ v: 'cobro', comanda })}
        onAgregar={(comandaId, etiqueta) => setVista({ v: 'adicion', comandaId, etiqueta })}
        onVolver={() => setVista({ v: 'captura' })}
      />
    );
  }

  if (vista.v === 'cobro') {
    return (
      <Cobro
        sesion={sesion}
        comanda={vista.comanda}
        motor={motor}
        onListo={() => {
          void sincronizar();
          setVista({ v: 'comandas' });
        }}
      />
    );
  }

  if (vista.v === 'turno') {
    return <Turno token={sesion.acceso} onVolver={() => setVista({ v: 'captura' })} />;
  }

  return (
    <Captura
      sesion={sesion}
      catalogo={catalogo}
      motor={motor}
      enLinea={enLineaReal}
      pendientes={pendientes}
      onSincronizar={() => void sincronizar()}
      onVerComandas={() => setVista({ v: 'comandas' })}
      onVerTurno={() => setVista({ v: 'turno' })}
      {...(vista.v === 'adicion'
        ? {
            adicion: { comandaId: vista.comandaId, etiqueta: vista.etiqueta },
            onListo: () => setVista({ v: 'comandas' }),
          }
        : {})}
    />
  );
}
