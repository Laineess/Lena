import { useCallback, useEffect, useRef, useState } from 'react';
import type { Comanda } from '@lena/shared';
import { obtenerCatalogo } from './dominio/api';
import type { Catalogo, DatosSesion } from './dominio/api';
import { cerrarSesion, crearMotor, fijarToken, reanudar, tokenAcceso } from './dominio/motor';
import type { Motor } from './dominio/motor';
import { AdminEscritorio } from './pantallas/AdminEscritorio';
import { Captura } from './pantallas/Captura';
import { Cobro } from './pantallas/Cobro';
import { Cocina } from './pantallas/Cocina';
import { Comandas } from './pantallas/Comandas';
import { Ingreso } from './pantallas/Ingreso';

type Estado = 'cargando' | 'ingreso' | 'captura' | 'admin';
type Vista =
  | { v: 'captura' }
  | { v: 'comandas' }
  | { v: 'adicion'; comandaId: string; etiqueta: string }
  | { v: 'cobro'; comanda: Comanda };

export function App() {
  const [estado, setEstado] = useState<Estado>('cargando');
  const [sesion, setSesion] = useState<DatosSesion | null>(null);
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [enLinea, setEnLinea] = useState(navigator.onLine);
  const [pendientes, setPendientes] = useState(0);
  const [vista, setVista] = useState<Vista>({ v: 'captura' });
  const motorRef = useRef<Motor | null>(null);

  const entrar = useCallback(async (datos: DatosSesion) => {
    setSesion(datos);
    // El gestor (superadmin/administrador) va al escritorio: sin sync, sin
    // catálogo local (RF-C-4).
    if (datos.sesion.rol === 'administrador' || datos.sesion.rol === 'superadmin') {
      fijarToken(datos);
      setEstado('admin');
      return;
    }
    motorRef.current = crearMotor(datos);
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

  // Cerrar sesión: limpia token + refresh y vuelve al ingreso. Los eventos aún
  // sin sincronizar quedan en Dexie (son del dispositivo) y reanudan al reentrar.
  const salir = useCallback(() => {
    cerrarSesion();
    motorRef.current = null;
    setCatalogo(null);
    setSesion(null);
    setVista({ v: 'captura' });
    setEstado('ingreso');
  }, []);

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
  // El admin: escritorio, sin motor ni catálogo local.
  if (estado === 'admin' && sesion) {
    return (
      <AdminEscritorio token={sesion.acceso} rol={sesion.sesion.rol} onSalir={salir} />
    );
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
        onSalir={salir}
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

  return (
    <Captura
      sesion={sesion}
      catalogo={catalogo}
      motor={motor}
      enLinea={enLineaReal}
      pendientes={pendientes}
      onSincronizar={() => void sincronizar()}
      onVerComandas={() => setVista({ v: 'comandas' })}
      onSalir={salir}
      {...(vista.v === 'adicion'
        ? {
            adicion: { comandaId: vista.comandaId, etiqueta: vista.etiqueta },
            onListo: () => setVista({ v: 'comandas' }),
          }
        : {})}
    />
  );
}
