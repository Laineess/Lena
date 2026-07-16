import { useCallback, useEffect, useRef, useState } from 'react';
import { obtenerCatalogo } from './dominio/api';
import type { Catalogo, DatosSesion } from './dominio/api';
import { crearMotor, reanudar, tokenAcceso } from './dominio/motor';
import type { Motor } from './dominio/motor';
import { Captura } from './pantallas/Captura';
import { Ingreso } from './pantallas/Ingreso';

type Estado = 'cargando' | 'ingreso' | 'captura';

export function App() {
  const [estado, setEstado] = useState<Estado>('cargando');
  const [sesion, setSesion] = useState<DatosSesion | null>(null);
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [enLinea, setEnLinea] = useState(navigator.onLine);
  const [pendientes, setPendientes] = useState(0);
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
  return (
    <Captura
      sesion={sesion}
      catalogo={catalogo}
      motor={motorRef.current as Motor}
      enLinea={enLinea && tokenAcceso() !== null}
      pendientes={pendientes}
      onSincronizar={() => void sincronizar()}
    />
  );
}
