// Ingreso (09 §3). Paso 1: clave de la sucursal. Paso 2: usuario → PIN (3 toques,
// RNF-U-1). El dueño/administrador entra aparte por correo. Tema oscuro.
import { useState } from 'react';
import { ErrorApi, loginAdmin, loginPin, sucursalPorClave } from '../dominio/api';
import type { DatosSesion, Usuario } from '../dominio/api';
import { Boton } from '../ui/Boton';
import { guardarLetra } from '../dominio/dispositivo';

const LARGO_PIN = 6;
const INPUT =
  'w-full max-w-xs rounded-md border border-carbon-600 bg-carbon-800 px-3 py-3 text-piedra-100 placeholder-piedra-500';

export function Ingreso({ onIngreso }: { onIngreso: (s: DatosSesion) => void }) {
  const [clave, setClave] = useState('');
  const [sucursal, setSucursal] = useState<{ nombre: string; usuarios: Usuario[] } | null>(null);
  const [sel, setSel] = useState<Usuario | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [modoAdmin, setModoAdmin] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function entrarClave() {
    setOcupado(true);
    setError(null);
    try {
      const r = await sucursalPorClave(clave.trim());
      guardarLetra(r.letra); // para el voceo A-1/B-3
      setSucursal({ nombre: r.nombre, usuarios: r.usuarios });
    } catch {
      setError('Clave de sucursal inválida');
    } finally {
      setOcupado(false);
    }
  }

  async function entrarAdmin() {
    setOcupado(true);
    setError(null);
    try {
      onIngreso(await loginAdmin({ email: email.trim(), password }));
    } catch {
      setError('Credenciales inválidas');
    } finally {
      setOcupado(false);
    }
  }

  async function enviarPin(pinFinal: string) {
    if (!sel) return;
    setOcupado(true);
    setError(null);
    try {
      onIngreso(await loginPin({ claveSucursal: clave.trim(), usuarioId: sel.id, pin: pinFinal }));
    } catch (e) {
      setPin('');
      if (e instanceof ErrorApi && e.status === 401) {
        const b = e.cuerpo.bloqueadoHasta;
        setError(typeof b === 'number' ? 'Sucursal bloqueada, espera unos minutos' : 'PIN incorrecto');
      } else setError('No se pudo entrar');
    } finally {
      setOcupado(false);
    }
  }

  function toca(d: string) {
    if (pin.length >= LARGO_PIN || ocupado) return;
    const nuevo = pin + d;
    setPin(nuevo);
    if (nuevo.length === LARGO_PIN) void enviarPin(nuevo);
  }

  // ── Dueño / administrador (correo) ──
  if (modoAdmin) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
        <h1 className="text-h1 font-bold text-oro-400">🔥 Leña · Gestión</h1>
        {error && <p className="font-semibold text-rojo-400">{error}</p>}
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Correo" className={INPUT} autoFocus />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Contraseña"
          className={INPUT}
        />
        <Boton onClick={() => void entrarAdmin()} disabled={ocupado || !email || !password} className="h-12 w-full max-w-xs">
          Entrar
        </Boton>
        <button type="button" onClick={() => { setModoAdmin(false); setError(null); }} className="text-sm text-piedra-500">
          ‹ Volver
        </button>
      </div>
    );
  }

  // ── Paso 1: clave de la sucursal ──
  if (!sucursal) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 p-6">
        <h1 className="text-h1 font-bold text-oro-400">🔥 Leña</h1>
        <p className="text-piedra-400">Escribe la clave de tu sucursal</p>
        {error && <p className="font-semibold text-rojo-400">{error}</p>}
        <input
          value={clave}
          onChange={(e) => setClave(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === 'Enter' && clave.trim() && void entrarClave()}
          placeholder="CLAVE"
          className={`${INPUT} text-center text-h2 font-bold tracking-widest`}
          autoFocus
        />
        <Boton onClick={() => void entrarClave()} disabled={ocupado || !clave.trim()} className="h-12 w-full max-w-xs">
          Continuar
        </Boton>
        <button type="button" onClick={() => setModoAdmin(true)} className="text-sm text-piedra-500 underline">
          Soy dueño o administrador
        </button>
      </div>
    );
  }

  // ── Paso 2a: elegir usuario ──
  if (!sel) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 p-6">
        <h1 className="text-h2 font-bold text-oro-400">🔥 {sucursal.nombre}</h1>
        {error && <p className="font-semibold text-rojo-400">{error}</p>}
        <div className="grid w-full max-w-sm grid-cols-2 gap-3">
          {sucursal.usuarios.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => setSel(u)}
              className="tactil flex flex-col items-center rounded-lg border border-carbon-700 bg-carbon-900 p-4 active:bg-carbon-800"
            >
              <span className="text-body-lg font-bold text-piedra-100">{u.nombre}</span>
              <span className="text-sm capitalize text-piedra-500">{u.rol}</span>
            </button>
          ))}
          {sucursal.usuarios.length === 0 && (
            <p className="col-span-2 text-center text-piedra-500">Esta sucursal aún no tiene meseros ni cocina.</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => { setSucursal(null); setClave(''); setError(null); }}
          className="text-sm text-piedra-500"
        >
          ‹ Cambiar de sucursal
        </button>
      </div>
    );
  }

  // ── Paso 2b: PIN ──
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-6">
      <button
        type="button"
        onClick={() => { setSel(null); setPin(''); setError(null); }}
        className="self-start text-piedra-500"
      >
        ‹ Volver
      </button>
      <h2 className="text-h2 font-bold text-piedra-100">{sel.nombre}</h2>

      <div className="flex gap-3" aria-label="progreso del PIN">
        {Array.from({ length: LARGO_PIN }, (_, i) => (
          <span key={i} className={`h-4 w-4 rounded-full ${i < pin.length ? 'bg-rojo-500' : 'bg-carbon-700'}`} />
        ))}
      </div>
      {error && <p className="font-semibold text-rojo-400">{error}</p>}

      <div className="grid grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => toca(d)}
            className="tactil h-16 w-20 rounded-md bg-carbon-800 text-2xl font-bold text-piedra-100 active:bg-carbon-700"
          >
            {d}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setPin(pin.slice(0, -1))}
          className="tactil h-16 w-20 rounded-md text-2xl text-piedra-300 active:bg-carbon-800"
        >
          ←
        </button>
        <button
          type="button"
          onClick={() => toca('0')}
          className="tactil h-16 w-20 rounded-md bg-carbon-800 text-2xl font-bold text-piedra-100 active:bg-carbon-700"
        >
          0
        </button>
        <span className="flex h-16 w-20 items-center justify-center text-piedra-500">{ocupado ? '…' : ''}</span>
      </div>
    </div>
  );
}
