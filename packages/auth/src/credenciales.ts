// Reglas de PIN y contraseña. Puras: se prueban sin base ni red.

// PIN triviales prohibidos (RS-A-6). La fecha de nacimiento se valida aparte,
// en el servicio, porque necesita el dato del usuario.
const PIN_TRIVIALES = new Set([
  '000000',
  '111111',
  '222222',
  '333333',
  '444444',
  '555555',
  '666666',
  '777777',
  '888888',
  '999999',
  '123456',
  '654321',
  '012345',
]);

export type ResultadoValidacion = { ok: true } | { ok: false; motivo: string };

// RS-A-3: PIN de 6 dígitos. RS-A-6: nada trivial ni secuencial.
export function validarPin(pin: string): ResultadoValidacion {
  if (!/^\d{6}$/.test(pin)) return { ok: false, motivo: 'El PIN debe ser de 6 dígitos' };
  if (PIN_TRIVIALES.has(pin)) return { ok: false, motivo: 'PIN demasiado común' };
  if (esSecuencia(pin)) return { ok: false, motivo: 'PIN secuencial' };
  return { ok: true };
}

// 123456 y 654321 ya están en la lista; esto atrapa cualquier corrida (345678).
function esSecuencia(pin: string): boolean {
  let sube = true;
  let baja = true;
  for (let i = 1; i < pin.length; i++) {
    const d = pin.charCodeAt(i) - pin.charCodeAt(i - 1);
    if (d !== 1) sube = false;
    if (d !== -1) baja = false;
  }
  return sube || baja;
}

// Las 20 contraseñas más filtradas que igual pasarían el largo de 12.
const PASSWORD_COMUNES = new Set([
  'contraseña123',
  'password1234',
  'qwerty123456',
  '123456789012',
  'administrador',
  'adminadmin12',
]);

// RS-A-2: contraseña de administrador ≥ 12, no en lista de comunes.
export function validarPassword(password: string): ResultadoValidacion {
  if (password.length < 12) return { ok: false, motivo: 'La contraseña debe tener al menos 12 caracteres' };
  if (PASSWORD_COMUNES.has(password.toLowerCase())) return { ok: false, motivo: 'Contraseña demasiado común' };
  return { ok: true };
}
