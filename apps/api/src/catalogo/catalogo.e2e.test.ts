import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { construirServidor } from '../servidor';
import type { Servidor } from '../servidor';
import { cerrarConexiones } from '../sync/fixtures';
import { CRED, sembrarCredenciales, sesionMesero, tokenAcceso } from '../auth/fixtures-auth';

let srv: Servidor;
let auth: { authorization: string };

beforeAll(async () => {
  srv = await construirServidor(undefined, { limiteGlobal: 100_000, limiteAuth: 100_000 });
  await sembrarCredenciales();
  auth = { authorization: `Bearer ${await tokenAcceso(sesionMesero())}` };
});

afterAll(async () => {
  await srv.cerrar();
  await cerrarConexiones();
});

describe('GET /catalogo', () => {
  it('exige sesión', async () => {
    const r = await srv.app.inject({ method: 'GET', url: '/catalogo' });
    expect(r.statusCode).toBe(401);
  });

  it('devuelve categorías, productos con precio en centavos y mesas', async () => {
    const r = await srv.app.inject({ method: 'GET', url: '/catalogo', headers: auth });
    expect(r.statusCode).toBe(200);
    const cat = r.json() as {
      categorias: unknown[];
      productos: { precio: number; disponible: boolean }[];
      mesas: unknown[];
    };
    expect(cat.categorias.length).toBeGreaterThan(0);
    expect(cat.productos.length).toBeGreaterThan(0);
    expect(cat.mesas.length).toBeGreaterThan(0);
    // Precio en centavos (entero), no en pesos (RNF-I-8).
    const pastor = cat.productos.find((p) => Number.isInteger(p.precio) && p.precio >= 1000);
    expect(pastor).toBeDefined();
  });
});

describe('POST /auth/dispositivo/usuarios', () => {
  it('con la credencial del dispositivo devuelve sus usuarios, sin admin', async () => {
    const r = await srv.app.inject({
      method: 'POST',
      url: '/auth/dispositivo/usuarios',
      payload: { dispositivoId: sesionMesero().dispositivoId, tokenDispositivo: CRED.tokenTabletA },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { usuarios: { rol: string }[] };
    expect(body.usuarios.length).toBeGreaterThan(0);
    expect(body.usuarios.every((u) => u.rol !== 'administrador')).toBe(true);
  });

  it('con credencial falsa niega (401)', async () => {
    const r = await srv.app.inject({
      method: 'POST',
      url: '/auth/dispositivo/usuarios',
      payload: { dispositivoId: sesionMesero().dispositivoId, tokenDispositivo: 'falso' },
    });
    expect(r.statusCode).toBe(401);
  });
});
