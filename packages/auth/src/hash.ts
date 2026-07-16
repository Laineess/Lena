// Argon2id para PIN y contraseñas (RS-A-1). Parámetros mínimos OWASP:
// 19 MiB de memoria, 2 iteraciones, paralelismo 1.
// Argon2id es el algoritmo por defecto de @node-rs/argon2; no se importa el
// enum porque es un const enum y choca con verbatimModuleSyntax.
import { hash, verify } from '@node-rs/argon2';

const OPCIONES = {
  memoryCost: 19_456, // KiB = 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashSecreto(secreto: string): Promise<string> {
  return hash(secreto, OPCIONES);
}

// verify devuelve false ante un hash inválido en vez de lanzar: un registro
// corrupto no debe tumbar el login, solo negarlo.
export async function verificarSecreto(hashGuardado: string, secreto: string): Promise<boolean> {
  try {
    return await verify(hashGuardado, secreto, OPCIONES);
  } catch {
    return false;
  }
}
