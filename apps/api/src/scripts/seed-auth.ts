// Credenciales de desarrollo. El seed de @lena/db deja hashes de juguete;
// esto pone hashes Argon2id reales para poder entrar desde la PWA en local.
//
//   pnpm --filter @lena/api seed:auth
//
// NO se corre en producción.
import { sql } from 'drizzle-orm';
import { hashSecreto, hashToken } from '@lena/auth';
import { crearDb } from '../db';

if (process.env.NODE_ENV === 'production') {
  throw new Error('seed:auth no se corre en producción');
}

const ID = {
  mesero1: '01930000-0000-7000-8000-000000000011',
  mesero2: '01930000-0000-7000-8000-000000000012',
  cocinero: '01930000-0000-7000-8000-000000000013',
  superadmin: '01930000-0000-7000-8000-000000000009',
  admin: '01930000-0000-7000-8000-000000000010',
  adminNorte: '01930000-0000-7000-8000-000000000014',
  tabletA: '01930000-0000-7000-8000-000000000020',
  tabletB: '01930000-0000-7000-8000-000000000021',
};

const CRED = {
  pinAna: '481920',
  pinLuis: '481922',
  pinMiguel: '481921',
  passwordSuper: 'ClaveSuper2026x',
  passwordAdmin: 'ClaveAdmin2026x',
  tokenTabletA: 'token-de-prueba-tableta-a',
  tokenTabletB: 'token-de-prueba-tableta-b',
};

const { db, sql: cliente } = crearDb(process.env.DATABASE_URL);

try {
  const [ana, luis, miguel, passSuper, passAdmin] = await Promise.all([
    hashSecreto(CRED.pinAna),
    hashSecreto(CRED.pinLuis),
    hashSecreto(CRED.pinMiguel),
    hashSecreto(CRED.passwordSuper),
    hashSecreto(CRED.passwordAdmin),
  ]);
  await db.execute(sql`UPDATE usuario SET pin_hash = ${ana} WHERE id = ${ID.mesero1}`);
  await db.execute(sql`UPDATE usuario SET pin_hash = ${luis} WHERE id = ${ID.mesero2}`);
  await db.execute(sql`UPDATE usuario SET pin_hash = ${miguel} WHERE id = ${ID.cocinero}`);
  await db.execute(sql`UPDATE usuario SET password_hash = ${passSuper} WHERE id = ${ID.superadmin}`);
  await db.execute(sql`UPDATE usuario SET password_hash = ${passAdmin} WHERE id = ${ID.admin}`);
  await db.execute(sql`UPDATE usuario SET password_hash = ${passAdmin} WHERE id = ${ID.adminNorte}`);
  await db.execute(
    sql`UPDATE dispositivo SET token_hash = ${hashToken(CRED.tokenTabletA)}, activo = true WHERE id = ${ID.tabletA}`,
  );
  await db.execute(
    sql`UPDATE dispositivo SET token_hash = ${hashToken(CRED.tokenTabletB)}, activo = true WHERE id = ${ID.tabletB}`,
  );

  console.log('✓ Credenciales de desarrollo listas:');
  console.log('  Ana (mesero)    PIN 481920   · Tablet A');
  console.log('  Luis (mesero)   PIN 481922   · Tablet B');
  console.log('  Miguel (cocina) PIN 481921');
  console.log('  super@lena.local / ClaveSuper2026x   (superadmin, global)');
  console.log('  admin@lena.local / ClaveAdmin2026x   (admin Centro)');
  console.log('  norte@lena.local / ClaveAdmin2026x   (admin Norte)');
  console.log('  Tablet A token: token-de-prueba-tableta-a');
} finally {
  await cliente.end();
}
