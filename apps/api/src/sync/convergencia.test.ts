// Pruebas de caos (2.8). El entregable de la fase: dos clientes offline
// convergen al reconectar, con CERO eventos perdidos y CERO duplicados
// (RNF-D-3), pase lo que pase con la red.
import { randomUUID } from 'node:crypto';
import fc from 'fast-check';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { MemoriaAlmacen, MotorSync } from '@lena/cliente';
import { plegarComanda } from '@lena/shared';
import type { Comanda } from '@lena/shared';
import { comandaEvento } from '@lena/db';
import { eq } from 'drizzle-orm';
import { TransporteCaotico } from './caos';
import type { Falla } from './caos';
import { aDominio } from './eventos';
import { abrirTurno, app, cerrarConexiones, dispositivo, ID, limpiar } from './fixtures';

const uuid = () => randomUUID();

beforeEach(async () => {
  await limpiar();
  await abrirTurno();
});

afterAll(async () => {
  await cerrarConexiones();
});

// Pliega el log del servidor para una comanda: la verdad contra la que se
// comparan los dos clientes.
async function estadoServidor(cid: string): Promise<Comanda | null> {
  const filas = await app.db.select().from(comandaEvento).where(eq(comandaEvento.comandaId, cid));
  return plegarComanda(cid, filas.map(aDominio));
}

async function idsEnServidor(): Promise<string[]> {
  const filas = await app.db.select({ id: comandaEvento.id }).from(comandaEvento);
  return filas.map((f) => f.id);
}

function igual(a: Comanda | null, b: Comanda | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Estabiliza: rondas de sincronizar() en ambos. sincronizar() se traga el
// ErrorRed, así que aunque el plan de fallos siga vivo, las rondas siguientes
// —ya con la red confiable— drenan la cola y jalan todo. Convergen en 2-3
// rondas reliables; 20 dan margen de sobra.
async function estabilizar(...motores: MotorSync[]): Promise<void> {
  for (let i = 0; i < 20; i++) {
    for (const m of motores) await m.sincronizar();
  }
}

describe('convergencia bajo caos', () => {
  it('dos dispositivos editan la MISMA comanda y convergen', async () => {
    const cid = uuid();
    const A = new MotorSync(new MemoriaAlmacen(), new TransporteCaotico(app.db, ['cae', 'respuesta_perdida']), {
      sucursalId: ID.sucursal,
      dispositivoId: ID.tabletA,
    });
    const B = new MotorSync(new MemoriaAlmacen(), new TransporteCaotico(app.db, ['cae', 'duplica']), {
      sucursalId: ID.sucursal,
      dispositivoId: ID.tabletB,
    });
    const da = dispositivo('A', { dispositivoId: ID.tabletA });
    const db = dispositivo('B', { actorId: ID.mesero2, dispositivoId: ID.tabletB });

    // A crea la comanda con una línea y sincroniza (con red hostil).
    await A.crear(da.ev(cid, { tipo: 'comanda_creada', tipoServicio: 'mesa', mesaId: ID.mesa1 }, { id: uuid() }));
    await A.crear(
      da.ev(
        cid,
        { tipo: 'linea_agregada', productoId: ID.pastor, nombreProducto: 'Pastor', precioUnitario: 1800, cantidad: 2 },
        { id: uuid(), detalleId: uuid() },
      ),
    );
    await estabilizar(A, B);

    // B se entera de la comanda por pull, y le agrega otra línea offline...
    await B.crear(
      db.ev(
        cid,
        { tipo: 'linea_agregada', productoId: ID.arabe, nombreProducto: 'Árabe', precioUnitario: 2000, cantidad: 1 },
        { id: uuid(), detalleId: uuid() },
      ),
    );
    // ...mientras A le agrega una tercera a la vez.
    await A.crear(
      da.ev(
        cid,
        { tipo: 'linea_agregada', productoId: ID.pastor, nombreProducto: 'Pastor', precioUnitario: 1800, cantidad: 3 },
        { id: uuid(), detalleId: uuid() },
      ),
    );

    await estabilizar(A, B);

    const ea = await A.comanda(cid);
    const eb = await B.comanda(cid);
    const es = await estadoServidor(cid);

    expect(igual(ea, es)).toBe(true);
    expect(igual(eb, es)).toBe(true);
    expect(ea?.lineas).toHaveLength(3); // ninguna línea se perdió
    expect(ea?.total).toBe(2 * 1800 + 2000 + 3 * 1800); // 13400
  });

  it('cancelación concurrente contra una adición: gana la cancelación', async () => {
    const cid = uuid();
    const A = new MotorSync(new MemoriaAlmacen(), new TransporteCaotico(app.db), {
      sucursalId: ID.sucursal,
      dispositivoId: ID.tabletA,
    });
    const B = new MotorSync(new MemoriaAlmacen(), new TransporteCaotico(app.db), {
      sucursalId: ID.sucursal,
      dispositivoId: ID.tabletB,
    });
    const da = dispositivo('A', { dispositivoId: ID.tabletA });
    const db = dispositivo('B', { actorId: ID.mesero2, dispositivoId: ID.tabletB });

    await A.crear(da.ev(cid, { tipo: 'comanda_creada', tipoServicio: 'para_llevar' }, { id: uuid() }));
    await A.crear(
      da.ev(
        cid,
        { tipo: 'linea_agregada', productoId: ID.pastor, nombreProducto: 'Pastor', precioUnitario: 1800, cantidad: 1 },
        { id: uuid(), detalleId: uuid() },
      ),
    );
    await estabilizar(A, B);

    // Offline y a la vez: A cancela la comanda, B le agrega una línea.
    await A.crear(da.ev(cid, { tipo: 'comanda_cancelada', motivo: 'el cliente se fue' }, { id: uuid() }));
    await B.crear(
      db.ev(
        cid,
        { tipo: 'linea_agregada', productoId: ID.arabe, nombreProducto: 'Árabe', precioUnitario: 2000, cantidad: 1 },
        { id: uuid(), detalleId: uuid() },
      ),
    );

    await estabilizar(A, B);

    const es = await estadoServidor(cid);
    expect(igual(await A.comanda(cid), es)).toBe(true);
    expect(igual(await B.comanda(cid), es)).toBe(true);
    expect(es?.estado).toBe('cancelada'); // RF-E-21
    expect(es?.total).toBe(0); // una comanda cancelada no cobra nada
  });

  it('entrega duplicada del lote: el log guarda cada evento una sola vez', async () => {
    const cid = uuid();
    const A = new MotorSync(new MemoriaAlmacen(), new TransporteCaotico(app.db, ['duplica', 'duplica']), {
      sucursalId: ID.sucursal,
      dispositivoId: ID.tabletA,
    });
    const da = dispositivo('A', { dispositivoId: ID.tabletA });

    await A.crear(da.ev(cid, { tipo: 'comanda_creada', tipoServicio: 'para_llevar' }, { id: uuid() }));
    await A.crear(
      da.ev(
        cid,
        { tipo: 'linea_agregada', productoId: ID.pastor, nombreProducto: 'Pastor', precioUnitario: 1800, cantidad: 2 },
        { id: uuid(), detalleId: uuid() },
      ),
    );
    await A.sincronizar();

    const ids = await idsEnServidor();
    expect(new Set(ids).size).toBe(ids.length); // sin duplicados
    expect(ids).toHaveLength(2);
  });
});

// ── Propiedad: sin importar el plan de fallos, converge sin pérdida ──

describe('convergencia (property-based)', () => {
  it('cualquier plan de fallos termina en cero pérdida y cero duplicados', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom<Falla>('ok', 'cae', 'respuesta_perdida', 'duplica'), {
          minLength: 0,
          maxLength: 8,
        }),
        fc.array(fc.constantFrom<Falla>('ok', 'cae', 'respuesta_perdida', 'duplica'), {
          minLength: 0,
          maxLength: 8,
        }),
        fc.integer({ min: 1, max: 3 }), // comandas de A
        fc.integer({ min: 1, max: 3 }), // comandas de B
        async (planA, planB, nA, nB) => {
          await limpiar();
          await abrirTurno();

          const A = new MotorSync(new MemoriaAlmacen(), new TransporteCaotico(app.db, planA), {
            sucursalId: ID.sucursal,
            dispositivoId: ID.tabletA,
          });
          const B = new MotorSync(new MemoriaAlmacen(), new TransporteCaotico(app.db, planB), {
            sucursalId: ID.sucursal,
            dispositivoId: ID.tabletB,
          });
          const da = dispositivo('A', { dispositivoId: ID.tabletA });
          const db = dispositivo('B', { actorId: ID.mesero2, dispositivoId: ID.tabletB });

          const generados = new Set<string>();
          const comandas: string[] = [];

          const sembrar = (motor: MotorSync, disp: typeof da, n: number) =>
            Promise.all(
              Array.from({ length: n }, async () => {
                const cid = uuid();
                comandas.push(cid);
                const e1 = disp.ev(cid, { tipo: 'comanda_creada', tipoServicio: 'para_llevar' }, { id: uuid() });
                const e2 = disp.ev(
                  cid,
                  {
                    tipo: 'linea_agregada',
                    productoId: ID.pastor,
                    nombreProducto: 'Pastor',
                    precioUnitario: 1800,
                    cantidad: 2,
                  },
                  { id: uuid(), detalleId: uuid() },
                );
                generados.add(e1.id).add(e2.id);
                await motor.crear(e1);
                await motor.crear(e2);
              }),
            );

          await sembrar(A, da, nA);
          await sembrar(B, db, nB);

          await estabilizar(A, B);

          // 1. Cero pérdida: todo lo generado está en el servidor.
          const ids = await idsEnServidor();
          const enServidor = new Set(ids);
          for (const g of generados) if (!enServidor.has(g)) return false;

          // 2. Cero duplicados en el log.
          if (new Set(ids).size !== ids.length) return false;

          // 3. Los dos clientes y el servidor pliegan lo mismo, comanda por comanda.
          for (const cid of comandas) {
            const es = await estadoServidor(cid);
            if (!igual(await A.comanda(cid), es)) return false;
            if (!igual(await B.comanda(cid), es)) return false;
          }
          return true;
        },
      ),
      { numRuns: 20 },
    );
  });
});
