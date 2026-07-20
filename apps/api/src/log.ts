// Registro (logs) a archivo + consola. Fastify (pino) escribe una línea JSON por
// evento — abrible en cualquier editor y fácil de filtrar (p. ej. `grep error`).
// Un archivo por día en logs/ (o LOG_DIR). Se activa solo en el arranque real;
// las pruebas corren en silencio.
import { createWriteStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Writable } from 'node:stream';

// Escribe cada línea a varios destinos (archivo del día + consola).
class MultiFlujo extends Writable {
  constructor(private readonly destinos: Writable[]) {
    super();
  }
  override _write(chunk: Buffer | string, _enc: BufferEncoding, cb: (e?: Error | null) => void): void {
    for (const d of this.destinos) d.write(chunk);
    cb();
  }
}

export function crearFlujoLog(): Writable {
  const dir = process.env.LOG_DIR ?? 'logs';
  mkdirSync(dir, { recursive: true });
  const hoy = new Date().toISOString().slice(0, 10);
  const archivo = createWriteStream(join(dir, `lena-${hoy}.log`), { flags: 'a' });
  return new MultiFlujo([archivo, process.stdout]);
}

// Captura los crashes que NO pasan por Fastify (promesas/excepciones sueltas):
// sin esto, el proceso muere y no queda rastro del error.
export function capturarProceso(flujo: Writable): void {
  const escribir = (tipo: string, err: unknown) => {
    const detalle = err instanceof Error ? { message: err.message, stack: err.stack } : err;
    flujo.write(`${JSON.stringify({ time: new Date().toISOString(), level: 'fatal', tipo, err: detalle })}\n`);
  };
  process.on('uncaughtException', (e) => escribir('uncaughtException', e));
  process.on('unhandledRejection', (e) => escribir('unhandledRejection', e));
}
