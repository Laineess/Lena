/**
 * Datos de prueba para desarrollo.
 *
 *   pnpm db:seed
 *
 * ⚠️ Solo para desarrollo. Aborta si NODE_ENV=production.
 *
 * Los PIN y contraseñas de aquí son de juguete y NO pasan por Argon2id
 * todavía (eso llega en la fase 3, RS-A-1). Los hash son marcadores.
 */
import { fileURLToPath } from 'node:url';
import { config as cargarEnv } from 'dotenv';
import { crearDb } from './index';
import {
  categoria,
  dispositivo,
  mesa,
  producto,
  sucursal,
  usuario,
} from './schema/index';

cargarEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

if (process.env.NODE_ENV === 'production') {
  throw new Error('El seed NO se corre en producción.');
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Falta DATABASE_URL.');

const db = crearDb(url);

// UUIDs fijos: el seed es idempotente y los tests pueden referenciarlos.
const ID = {
  sucursal: '01930000-0000-7000-8000-000000000001',
  admin: '01930000-0000-7000-8000-000000000010',
  mesero1: '01930000-0000-7000-8000-000000000011',
  mesero2: '01930000-0000-7000-8000-000000000012',
  cocinero: '01930000-0000-7000-8000-000000000013',
  tabletA: '01930000-0000-7000-8000-000000000020',
  tabletB: '01930000-0000-7000-8000-000000000021',
  pantallaCocina: '01930000-0000-7000-8000-000000000022',
  catTacos: '01930000-0000-7000-8000-000000000030',
  catBebidas: '01930000-0000-7000-8000-000000000031',
  catExtras: '01930000-0000-7000-8000-000000000032',
} as const;

const uuid = (n: number) => `01930000-0000-7000-8000-0000000${String(n).padStart(5, '0')}`;

console.log('Sembrando…');

await db.insert(sucursal).values({
  id: ID.sucursal,
  nombre: 'Centro',
  direccion: 'Av. Juárez 100, Pachuca, Hgo.',
}).onConflictDoNothing();

await db.insert(usuario).values([
  {
    id: ID.admin,
    sucursalId: null, // Alcance global (RF-C-4)
    nombre: 'Carlos González',
    rol: 'administrador',
    email: 'admin@lena.local',
    passwordHash: 'DEV_PLACEHOLDER_argon2id',
  },
  { id: ID.mesero1, sucursalId: ID.sucursal, nombre: 'Ana', rol: 'mesero', pinHash: 'DEV_PIN_111111' },
  { id: ID.mesero2, sucursalId: ID.sucursal, nombre: 'Luis', rol: 'mesero', pinHash: 'DEV_PIN_222222' },
  { id: ID.cocinero, sucursalId: ID.sucursal, nombre: 'Miguel', rol: 'cocina', pinHash: 'DEV_PIN_333333' },
]).onConflictDoNothing();

// La letra alimenta el identificador que se vocea en "para llevar": A-7, B-3
// (09. Diseño de interfaz §4.2). Funciona sin red, a diferencia del folio.
await db.insert(dispositivo).values([
  { id: ID.tabletA, sucursalId: ID.sucursal, nombre: 'Tablet Ana', letra: 'A' },
  { id: ID.tabletB, sucursalId: ID.sucursal, nombre: 'Tablet Luis', letra: 'B' },
  { id: ID.pantallaCocina, sucursalId: ID.sucursal, nombre: 'Pantalla Cocina', letra: 'K' },
]).onConflictDoNothing();

await db.insert(mesa).values(
  Array.from({ length: 8 }, (_, i) => ({
    id: uuid(100 + i),
    sucursalId: ID.sucursal,
    nombre: `Mesa ${i + 1}`,
  })),
).onConflictDoNothing();

await db.insert(categoria).values([
  { id: ID.catTacos, nombre: 'Tacos', orden: 1 },
  { id: ID.catBebidas, nombre: 'Bebidas', orden: 2 },
  { id: ID.catExtras, nombre: 'Extras', orden: 3 },
]).onConflictDoNothing();

await db.insert(producto).values([
  { id: uuid(200), categoriaId: ID.catTacos, nombre: 'Pastor', precioBase: '18.00' },
  { id: uuid(201), categoriaId: ID.catTacos, nombre: 'Árabe', precioBase: '20.00' },
  { id: uuid(202), categoriaId: ID.catTacos, nombre: 'Suadero', precioBase: '18.00' },
  { id: uuid(203), categoriaId: ID.catTacos, nombre: 'Bistec', precioBase: '18.00' },
  { id: uuid(204), categoriaId: ID.catTacos, nombre: 'Campechano', precioBase: '22.00' },
  // disponible=false ejercita RF-D-7 en la UI desde el primer día.
  { id: uuid(205), categoriaId: ID.catTacos, nombre: 'Chorizo', precioBase: '18.00', disponible: false },
  { id: uuid(206), categoriaId: ID.catBebidas, nombre: 'Refresco', precioBase: '25.00' },
  { id: uuid(207), categoriaId: ID.catBebidas, nombre: 'Agua de horchata', precioBase: '30.00' },
  { id: uuid(208), categoriaId: ID.catBebidas, nombre: 'Agua natural', precioBase: '15.00' },
  { id: uuid(209), categoriaId: ID.catExtras, nombre: 'Queso fundido', precioBase: '45.00' },
  { id: uuid(210), categoriaId: ID.catExtras, nombre: 'Orden de cebollitas', precioBase: '20.00' },
]).onConflictDoNothing();

console.log('✓ Listo: 1 sucursal · 4 usuarios · 3 dispositivos · 8 mesas · 11 productos');
console.log('  Admin: admin@lena.local');
console.log('  PIN de desarrollo: Ana 111111 · Luis 222222 · Miguel 333333');

process.exit(0);
