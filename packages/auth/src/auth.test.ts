import { describe, expect, it } from 'vitest';
import { validarPassword, validarPin } from './credenciales';
import { hashSecreto, verificarSecreto } from './hash';
import { firmarAcceso, verificarAcceso } from './jwt';
import type { Sesion } from './jwt';
import { bloqueadoHasta, estaBloqueado } from './lockout';
import { generarToken, hashToken, tokenCoincide } from './tokens';

const SECRETO = 'x'.repeat(48);

describe('hash Argon2id (RS-A-1)', () => {
  it('un secreto se verifica contra su hash', async () => {
    const h = await hashSecreto('111213');
    expect(h).not.toContain('111213'); // jamás en claro
    expect(await verificarSecreto(h, '111213')).toBe(true);
    expect(await verificarSecreto(h, '111214')).toBe(false);
  });

  it('el hash es distinto cada vez (salt aleatorio)', async () => {
    expect(await hashSecreto('secreto')).not.toBe(await hashSecreto('secreto'));
  });

  it('un hash corrupto niega, no revienta', async () => {
    expect(await verificarSecreto('no-es-un-hash', 'x')).toBe(false);
  });
});

describe('validarPin (RS-A-3, RS-A-6)', () => {
  it('acepta un PIN de 6 dígitos no trivial', () => {
    expect(validarPin('481920').ok).toBe(true);
  });

  it('rechaza largo incorrecto y no numéricos', () => {
    expect(validarPin('12345').ok).toBe(false);
    expect(validarPin('1234567').ok).toBe(false);
    expect(validarPin('12a456').ok).toBe(false);
  });

  it('rechaza triviales y secuencias', () => {
    for (const malo of ['000000', '111111', '123456', '654321', '345678']) {
      expect(validarPin(malo).ok, malo).toBe(false);
    }
  });
});

describe('validarPassword (RS-A-2)', () => {
  it('exige al menos 12 caracteres', () => {
    expect(validarPassword('corta1').ok).toBe(false);
    expect(validarPassword('doceletrasok').ok).toBe(true);
  });

  it('rechaza comunes', () => {
    expect(validarPassword('administrador').ok).toBe(false);
  });
});

describe('JWT de acceso (RS-A-7)', () => {
  const sesion: Sesion = {
    usuarioId: 'u-1',
    rol: 'mesero',
    sucursalId: 's-1',
    dispositivoId: 'd-1',
  };

  it('ida y vuelta conserva la sesión', async () => {
    const token = await firmarAcceso(sesion, SECRETO);
    expect(await verificarAcceso(token, SECRETO)).toEqual(sesion);
  });

  it('un token firmado con otro secreto se rechaza', async () => {
    const token = await firmarAcceso(sesion, SECRETO);
    await expect(verificarAcceso(token, 'y'.repeat(48))).rejects.toThrow();
  });

  it('un token vencido se rechaza', async () => {
    const token = await firmarAcceso(sesion, SECRETO, '0s');
    await new Promise((r) => setTimeout(r, 1100));
    await expect(verificarAcceso(token, SECRETO)).rejects.toThrow();
  });

  it('un secreto corto no se acepta', async () => {
    await expect(firmarAcceso(sesion, 'corto')).rejects.toThrow();
  });
});

describe('tokens opacos (refresh, dispositivo)', () => {
  it('el token no aparece en su hash y coincide en tiempo constante', () => {
    const t = generarToken();
    const h = hashToken(t);
    expect(h).not.toContain(t);
    expect(tokenCoincide(t, h)).toBe(true);
    expect(tokenCoincide(generarToken(), h)).toBe(false);
  });
});

describe('lockout (RS-A-4)', () => {
  it('menos de 5 fallos no bloquea', () => {
    const fallos = [new Date()];
    expect(estaBloqueado(fallos)).toBe(false);
  });

  it('5 fallos bloquean 5 minutos', () => {
    const ahora = Date.now();
    const fallos = Array.from({ length: 5 }, () => new Date(ahora - 1000));
    const hasta = bloqueadoHasta(fallos, ahora);
    expect(hasta).not.toBeNull();
    expect((hasta as number) - ahora).toBeGreaterThan(4 * 60_000);
  });

  it('el bloqueo expira con el tiempo', () => {
    const viejo = Date.now() - 10 * 60_000;
    const fallos = Array.from({ length: 5 }, () => new Date(viejo));
    expect(estaBloqueado(fallos, Date.now())).toBe(false);
  });

  it('la reincidencia alarga el bloqueo (backoff)', () => {
    const ahora = Date.now();
    const cinco = Array.from({ length: 5 }, () => new Date(ahora - 1000));
    const diez = Array.from({ length: 10 }, () => new Date(ahora - 1000));
    const b5 = (bloqueadoHasta(cinco, ahora) as number) - ahora;
    const b10 = (bloqueadoHasta(diez, ahora) as number) - ahora;
    expect(b10).toBeGreaterThan(b5);
  });
});
