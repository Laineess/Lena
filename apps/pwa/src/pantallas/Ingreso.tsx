// Ingreso con PIN (09 §3). 3 toques: usuario → PIN → ✓ (RNF-U-1). El teclado
// es numérico propio; nunca aparece un teclado alfanumérico en el flujo.
import { useEffect, useState } from 'react';
import { ErrorApi, loginAdmin, loginPin, usuariosDeDispositivo } from '../dominio/api';
import type { DatosSesion, Usuario } from '../dominio/api';
import { Boton } from '../ui/Boton';
import { configDispositivo } from '../dominio/dispositivo';

const LARGO_PIN = 6;

export function Ingreso({ onIngreso }: { onIngreso: (s: DatosSesion) => void }) {
  const disp = configDispositivo();
  const [usuarios, setUsuarios] = useState<Usuario[] | null>(null);
  const [sel, setSel] = useState<Usuario | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [modoAdmin, setModoAdmin] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

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

  useEffect(() => {
    // La lista se cachea para el ingreso offline (RS-A-3); aquí se trae en línea.
    usuariosDeDispositivo(disp.dispositivoId, disp.tokenDispositivo)
      .then((r) => {
        setUsuarios(r.usuarios);
        localStorage.setItem('lena.usuarios', JSON.stringify(r.usuarios));
      })
      .catch(() => {
        const cache = localStorage.getItem('lena.usuarios');
        if (cache) setUsuarios(JSON.parse(cache) as Usuario[]);
        else setError('Sin conexión y sin lista de usuarios en caché');
      });
  }, [disp.dispositivoId, disp.tokenDispositivo]);

  if (modoAdmin) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
        <h1 className="text-h1 font-bold text-brasa-700">🔥 Leña · Admin</h1>
        {error && <p className="text-error">{error}</p>}
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Correo"
          className="w-full max-w-xs rounded-md border border-piedra-300 px-3 py-3"
          autoFocus
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Contraseña"
          className="w-full max-w-xs rounded-md border border-piedra-300 px-3 py-3"
        />
        <Boton
          onClick={() => void entrarAdmin()}
          disabled={ocupado || !email || !password}
          className="h-12 w-full max-w-xs"
        >
          Entrar
        </Boton>
        <button
          type="button"
          onClick={() => {
            setModoAdmin(false);
            setError(null);
          }}
          className="text-sm text-piedra-500"
        >
          ‹ Volver al PIN
        </button>
      </div>
    );
  }

  async function enviar(pinFinal: string) {
    if (!sel) return;
    setOcupado(true);
    setError(null);
    try {
      const datos = await loginPin({
        dispositivoId: disp.dispositivoId,
        tokenDispositivo: disp.tokenDispositivo,
        usuarioId: sel.id,
        pin: pinFinal,
      });
      onIngreso(datos);
    } catch (e) {
      setPin('');
      if (e instanceof ErrorApi && e.status === 401) {
        const b = e.cuerpo.bloqueadoHasta;
        setError(typeof b === 'number' ? 'Dispositivo bloqueado, espera unos minutos' : 'PIN incorrecto');
      } else setError('No se pudo entrar');
    } finally {
      setOcupado(false);
    }
  }

  function toca(d: string) {
    if (pin.length >= LARGO_PIN || ocupado) return;
    const nuevo = pin + d;
    setPin(nuevo);
    if (nuevo.length === LARGO_PIN) void enviar(nuevo);
  }

  if (!sel) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-8 p-6">
        <h1 className="text-h1 font-bold text-brasa-700">🔥 Leña</h1>
        {error && <p className="text-error">{error}</p>}
        <div className="grid w-full max-w-sm grid-cols-2 gap-3">
          {(usuarios ?? []).map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => setSel(u)}
              className="tactil flex flex-col items-center rounded-lg border border-piedra-200 bg-white p-4 active:bg-piedra-100"
            >
              <span className="text-body-lg font-semibold">{u.nombre}</span>
              <span className="text-sm capitalize text-piedra-500">{u.rol}</span>
            </button>
          ))}
          {usuarios === null && !error && <p className="col-span-2 text-center text-piedra-500">Cargando…</p>}
        </div>
        <button type="button" onClick={() => setModoAdmin(true)} className="text-sm text-piedra-500 underline">
          Soy administrador
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-6">
      <button
        type="button"
        onClick={() => {
          setSel(null);
          setPin('');
          setError(null);
        }}
        className="self-start text-piedra-500"
      >
        ‹ Volver
      </button>
      <h2 className="text-h2 font-semibold">{sel.nombre}</h2>

      <div className="flex gap-3" aria-label="progreso del PIN">
        {Array.from({ length: LARGO_PIN }, (_, i) => (
          <span key={i} className={`h-4 w-4 rounded-full ${i < pin.length ? 'bg-brasa-700' : 'bg-piedra-200'}`} />
        ))}
      </div>
      {error && <p className="text-error">{error}</p>}

      <div className="grid grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => toca(d)}
            className="tactil h-16 w-20 rounded-md bg-piedra-100 text-2xl font-semibold active:bg-piedra-200"
          >
            {d}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setPin(pin.slice(0, -1))}
          className="tactil h-16 w-20 rounded-md text-2xl active:bg-piedra-100"
        >
          ←
        </button>
        <button
          type="button"
          onClick={() => toca('0')}
          className="tactil h-16 w-20 rounded-md bg-piedra-100 text-2xl font-semibold active:bg-piedra-200"
        >
          0
        </button>
        <span className="flex h-16 w-20 items-center justify-center text-piedra-300">{ocupado ? '…' : ''}</span>
      </div>
    </div>
  );
}
