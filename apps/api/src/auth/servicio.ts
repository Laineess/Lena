// Servicio de autenticación (fase 3). Toda la lógica con estado en base;
// la criptografía pura vive en @lena/auth.
import { and, eq, gt } from 'drizzle-orm';
import {
  type Sesion,
  bloqueadoHasta,
  firmarAcceso,
  generarToken,
  hashToken,
  verificarSecreto,
  tokenCoincide,
} from '@lena/auth';
import { dispositivo, intentoAuth, sesion as sesionTbl, usuario } from '@lena/db';
import type { Db } from '../db';

const TTL_REFRESH_MS: Record<Sesion['rol'], number> = {
  administrador: 30 * 60_000, // inactividad 30 min (RS-A-7)
  mesero: 30 * 24 * 3_600_000, // sesión persistente en dispositivo (RS-A-8)
  cocina: 30 * 24 * 3_600_000,
};

export type Resultado =
  | { ok: true; acceso: string; refresh: string; sesion: Sesion }
  | { ok: false; motivo: string; bloqueadoHasta?: number };

function secreto(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('Falta JWT_SECRET');
  return s;
}

async function registrarIntento(
  db: Db,
  datos: {
    usuarioId?: string | undefined;
    dispositivoId?: string | undefined;
    exito: boolean;
    ip?: string | undefined;
    motivo?: string | undefined;
  },
): Promise<void> {
  await db.insert(intentoAuth).values({
    usuarioId: datos.usuarioId ?? null,
    dispositivoId: datos.dispositivoId ?? null,
    exito: datos.exito,
    ip: datos.ip ?? null,
    motivo: datos.motivo ?? null,
  });
}

// Fallos desde el último éxito, dentro de la última hora, para el bloqueo.
async function fallosRecientes(db: Db, dispositivoId: string): Promise<Date[]> {
  const desde = new Date(Date.now() - 60 * 60_000);
  const filas = await db
    .select({ exito: intentoAuth.exito, createdAt: intentoAuth.createdAt })
    .from(intentoAuth)
    .where(and(eq(intentoAuth.dispositivoId, dispositivoId), gt(intentoAuth.createdAt, desde)))
    .orderBy(intentoAuth.createdAt);

  const fallos: Date[] = [];
  for (const f of filas) {
    if (f.exito)
      fallos.length = 0; // un éxito reinicia la cuenta
    else fallos.push(f.createdAt);
  }
  return fallos;
}

async function emitirSesion(db: Db, s: Sesion, familia?: string): Promise<{ acceso: string; refresh: string }> {
  const refresh = generarToken();
  const expiraAt = new Date(Date.now() + TTL_REFRESH_MS[s.rol]);
  await db.insert(sesionTbl).values({
    usuarioId: s.usuarioId,
    dispositivoId: s.dispositivoId,
    refreshHash: hashToken(refresh),
    ...(familia ? { familia } : {}),
    expiraAt,
  });
  const acceso = await firmarAcceso(s, secreto());
  return { acceso, refresh };
}

// ── Login de administrador (email + contraseña) ──────────────

export async function loginAdmin(db: Db, datos: { email: string; password: string; ip?: string }): Promise<Resultado> {
  const [u] = await db
    .select()
    .from(usuario)
    .where(and(eq(usuario.email, datos.email), eq(usuario.rol, 'administrador'), eq(usuario.activo, true)))
    .limit(1);

  if (!u?.passwordHash || !(await verificarSecreto(u.passwordHash, datos.password))) {
    await registrarIntento(db, { usuarioId: u?.id, exito: false, ip: datos.ip, motivo: 'credenciales' });
    return { ok: false, motivo: 'credenciales inválidas' };
  }

  const s: Sesion = { usuarioId: u.id, rol: 'administrador', sucursalId: null, dispositivoId: null };
  const { acceso, refresh } = await emitirSesion(db, s);
  await registrarIntento(db, { usuarioId: u.id, exito: true, ip: datos.ip });
  return { ok: true, acceso, refresh, sesion: s };
}

// ── Login de mesero/cocina (dispositivo + PIN) ───────────────

export async function loginPin(
  db: Db,
  datos: { dispositivoId: string; tokenDispositivo: string; usuarioId: string; pin: string; ip?: string },
): Promise<Resultado> {
  const [disp] = await db.select().from(dispositivo).where(eq(dispositivo.id, datos.dispositivoId)).limit(1);

  // RS-A-3: solo desde un dispositivo registrado y activo, con su credencial.
  if (!disp || !disp.activo || !disp.tokenHash || !tokenCoincide(datos.tokenDispositivo, disp.tokenHash)) {
    await registrarIntento(db, {
      dispositivoId: datos.dispositivoId,
      exito: false,
      motivo: 'dispositivo',
      ip: datos.ip,
    });
    return { ok: false, motivo: 'dispositivo no autorizado' };
  }

  // RS-A-4: bloqueo por intentos fallidos en este dispositivo.
  const hasta = bloqueadoHasta(await fallosRecientes(db, disp.id));
  if (hasta !== null) {
    await registrarIntento(db, { dispositivoId: disp.id, exito: false, motivo: 'bloqueado', ip: datos.ip });
    return { ok: false, motivo: 'dispositivo bloqueado por intentos fallidos', bloqueadoHasta: hasta };
  }

  const [u] = await db
    .select()
    .from(usuario)
    .where(and(eq(usuario.id, datos.usuarioId), eq(usuario.sucursalId, disp.sucursalId), eq(usuario.activo, true)))
    .limit(1);

  // RS-Z-2: el rol y la sucursal salen del servidor, no del cliente.
  if (!u || u.rol === 'administrador' || !u.pinHash || !(await verificarSecreto(u.pinHash, datos.pin))) {
    await registrarIntento(db, { dispositivoId: disp.id, usuarioId: u?.id, exito: false, motivo: 'pin', ip: datos.ip });
    return { ok: false, motivo: 'PIN inválido' };
  }

  const s: Sesion = { usuarioId: u.id, rol: u.rol, sucursalId: disp.sucursalId, dispositivoId: disp.id };
  const { acceso, refresh } = await emitirSesion(db, s);
  await registrarIntento(db, { dispositivoId: disp.id, usuarioId: u.id, exito: true, ip: datos.ip });
  return { ok: true, acceso, refresh, sesion: s };
}

// ── Refresh rotatorio con detección de reuso (RS-A-12) ───────

export async function refrescar(db: Db, datos: { refresh: string; ip?: string }): Promise<Resultado> {
  const [fila] = await db
    .select()
    .from(sesionTbl)
    .where(eq(sesionTbl.refreshHash, hashToken(datos.refresh)))
    .limit(1);

  if (!fila) return { ok: false, motivo: 'refresh desconocido' };

  // Un token YA revocado que se vuelve a presentar = robo. Se revoca la
  // familia entera: el ladrón y la víctima quedan fuera, y la víctima re-entra.
  if (fila.revocadaAt) {
    await db.update(sesionTbl).set({ revocadaAt: new Date() }).where(eq(sesionTbl.familia, fila.familia));
    return { ok: false, motivo: 'refresh reutilizado; sesión revocada' };
  }

  if (fila.expiraAt.getTime() < Date.now()) {
    return { ok: false, motivo: 'refresh expirado' };
  }

  // Datos de la sesión desde la base (nunca del cliente).
  const [u] = await db.select().from(usuario).where(eq(usuario.id, fila.usuarioId)).limit(1);
  if (!u || !u.activo) return { ok: false, motivo: 'usuario inactivo' };

  let sucursalId: string | null = null;
  if (fila.dispositivoId) {
    const [disp] = await db.select().from(dispositivo).where(eq(dispositivo.id, fila.dispositivoId)).limit(1);
    // RS-A-9: un dispositivo revocado pierde acceso al refrescar.
    if (!disp || !disp.activo) return { ok: false, motivo: 'dispositivo revocado' };
    sucursalId = disp.sucursalId;
  } else {
    sucursalId = u.sucursalId ?? null;
  }

  const s: Sesion = { usuarioId: u.id, rol: u.rol, sucursalId, dispositivoId: fila.dispositivoId };

  // Rotación: se revoca la actual y se emite otra en la misma familia.
  await db.update(sesionTbl).set({ revocadaAt: new Date() }).where(eq(sesionTbl.id, fila.id));
  const { acceso, refresh } = await emitirSesion(db, s, fila.familia);
  return { ok: true, acceso, refresh, sesion: s };
}

export async function logout(db: Db, refresh: string): Promise<void> {
  await db
    .update(sesionTbl)
    .set({ revocadaAt: new Date() })
    .where(eq(sesionTbl.refreshHash, hashToken(refresh)));
}

// ── Dispositivos (RS-A-9) ────────────────────────────────────

export async function registrarDispositivo(
  db: Db,
  datos: { sucursalId: string; nombre: string; letra: string },
): Promise<{ dispositivoId: string; token: string }> {
  const token = generarToken();
  const [d] = await db
    .insert(dispositivo)
    .values({
      id: crypto.randomUUID(),
      sucursalId: datos.sucursalId,
      nombre: datos.nombre,
      letra: datos.letra,
      tokenHash: hashToken(token),
    })
    .returning({ id: dispositivo.id });
  return { dispositivoId: d?.id as string, token };
}

// Usuarios que pueden entrar desde un dispositivo (RS-A-3): los activos de su
// sucursal, sin admin. La lista alimenta la pantalla de PIN y se cachea para
// que el ingreso funcione offline.
export async function usuariosDeDispositivo(
  db: Db,
  dispositivoId: string,
  tokenDispositivo: string,
): Promise<{ ok: true; sucursalId: string; usuarios: { id: string; nombre: string; rol: string }[] } | { ok: false }> {
  const [disp] = await db.select().from(dispositivo).where(eq(dispositivo.id, dispositivoId)).limit(1);
  if (!disp || !disp.activo || !disp.tokenHash || !tokenCoincide(tokenDispositivo, disp.tokenHash)) {
    return { ok: false };
  }
  const filas = await db
    .select({ id: usuario.id, nombre: usuario.nombre, rol: usuario.rol })
    .from(usuario)
    .where(and(eq(usuario.sucursalId, disp.sucursalId), eq(usuario.activo, true)));
  return {
    ok: true,
    sucursalId: disp.sucursalId,
    usuarios: filas.filter((u) => u.rol !== 'administrador'),
  };
}

export async function revocarDispositivo(db: Db, dispositivoId: string): Promise<void> {
  // El dispositivo pierde acceso al reconectar (el refresh falla). Su outbox
  // sobrevive en el cliente: RS-A-9 exige vaciarla antes de borrar (RS-L-5).
  await db.update(dispositivo).set({ activo: false }).where(eq(dispositivo.id, dispositivoId));
  // Revoca sus sesiones vivas.
  await db.update(sesionTbl).set({ revocadaAt: new Date() }).where(eq(sesionTbl.dispositivoId, dispositivoId));
}

export type { Sesion };
