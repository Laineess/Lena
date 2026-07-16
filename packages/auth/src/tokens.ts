// Tokens opacos de refresh y credencial de dispositivo.
//
// Van con SHA-256, NO con Argon2: son de alta entropía (32 bytes aleatorios),
// así que no hay nada que reforzar contra fuerza bruta. Argon2 es para
// secretos débiles (PIN, contraseña); usarlo aquí solo gastaría CPU.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function generarToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Comparación en tiempo constante: sin esto, el tiempo de respuesta filtraría
// cuántos caracteres del hash coinciden.
export function tokenCoincide(token: string, hashGuardado: string): boolean {
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(hashGuardado, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
