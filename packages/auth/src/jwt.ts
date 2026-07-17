// JWT de acceso, vida corta (RS-A-7: 15 min). Firmado HS256.
import { SignJWT, jwtVerify } from 'jose';

export type Rol = 'superadmin' | 'administrador' | 'cocina' | 'mesero';

export interface Sesion {
  usuarioId: string;
  rol: Rol;
  // null solo para el superadmin (alcance global, RF-C-4). El administrador
  // ahora va anclado a su sucursal.
  sucursalId: string | null;
  // El admin puede entrar sin dispositivo registrado; mesero/cocina no.
  dispositivoId: string | null;
}

export const TTL_ACCESO = '15m';

function clave(secreto: string): Uint8Array {
  if (!secreto || secreto.length < 32) {
    throw new Error('JWT_SECRET ausente o muy corto (mínimo 32 caracteres)');
  }
  return new TextEncoder().encode(secreto);
}

// async para que un secreto inválido salga como rechazo, no como throw síncrono.
export async function firmarAcceso(sesion: Sesion, secreto: string, ttl: string = TTL_ACCESO): Promise<string> {
  return new SignJWT({ rol: sesion.rol, suc: sesion.sucursalId, disp: sesion.dispositivoId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sesion.usuarioId)
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(clave(secreto));
}

// Lanza si el token está vencido, alterado o mal firmado.
export async function verificarAcceso(token: string, secreto: string): Promise<Sesion> {
  const { payload } = await jwtVerify(token, clave(secreto), { algorithms: ['HS256'] });
  return {
    usuarioId: String(payload.sub),
    rol: payload.rol as Rol,
    sucursalId: (payload.suc as string | null) ?? null,
    dispositivoId: (payload.disp as string | null) ?? null,
  };
}
