// Fixtures de autenticación para las pruebas e2e. El seed deja hashes de
// juguete (DEV_PIN_...); aquí se ponen hashes Argon2id reales y un token de
// dispositivo, todo por el dueño (owner).
import { sql } from 'drizzle-orm';
import { firmarAcceso, hashSecreto, hashToken } from '@lena/auth';
import type { Sesion } from '@lena/auth';
import { ID, owner } from '../sync/fixtures';

export const CRED = {
  pinMesero: '481920',
  pinCocina: '481921',
  emailAdmin: 'admin@lena.local',
  passwordAdmin: 'ClaveAdmin2026x',
  tokenTabletA: 'token-de-prueba-tableta-a',
  adminId: '01930000-0000-7000-8000-000000000010',
} as const;

// Deja las credenciales reales en la base. Idempotente.
export async function sembrarCredenciales(): Promise<void> {
  const [pinM, pinC, pass] = await Promise.all([
    hashSecreto(CRED.pinMesero),
    hashSecreto(CRED.pinCocina),
    hashSecreto(CRED.passwordAdmin),
  ]);
  await owner.db.execute(sql`UPDATE usuario SET pin_hash = ${pinM} WHERE id = ${ID.mesero1}`);
  await owner.db.execute(sql`UPDATE usuario SET pin_hash = ${pinC} WHERE id = ${ID.cocinero}`);
  await owner.db.execute(
    sql`UPDATE usuario SET password_hash = ${pass}, email = ${CRED.emailAdmin} WHERE id = ${CRED.adminId}`,
  );
  // Dispositivo activo con credencial y sin bloqueos previos.
  await owner.db.execute(
    sql`UPDATE dispositivo SET token_hash = ${hashToken(CRED.tokenTabletA)}, activo = true WHERE id = ${ID.tabletA}`,
  );
  await owner.db.execute(sql`UPDATE dispositivo SET activo = true WHERE id = ${ID.tabletB}`);
}

export async function limpiarAuth(): Promise<void> {
  await owner.db.execute(sql`TRUNCATE sesion, intento_auth RESTART IDENTITY`);
}

// Mint directo de un JWT de acceso: para probar rutas protegidas sin repetir el
// login en cada test de sync.
export function tokenAcceso(sesion: Sesion): Promise<string> {
  const secreto = process.env.JWT_SECRET;
  if (!secreto) throw new Error('Falta JWT_SECRET');
  return firmarAcceso(sesion, secreto);
}

export function sesionMesero(): Sesion {
  return { usuarioId: ID.mesero1, rol: 'mesero', sucursalId: ID.sucursal, dispositivoId: ID.tabletA };
}

// El admin: alcance global (sucursalId null), sin dispositivo (RF-C-4).
export function sesionAdmin(): Sesion {
  return { usuarioId: CRED.adminId, rol: 'administrador', sucursalId: null, dispositivoId: null };
}
