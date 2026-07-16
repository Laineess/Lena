// Une el almacén persistente (Dexie), el transporte HTTP y el motor de sync.
// Un solo motor por sesión; el token de acceso vive aquí y se refresca solo.
import { MotorSync } from '@lena/cliente';
import { AlmacenDexie } from '../almacen/almacen-dexie';
import { TransporteHttp } from '../almacen/transporte-http';
import { refrescar } from './api';
import type { DatosSesion } from './api';

let acceso: string | null = null;

export function tokenAcceso(): string | null {
  return acceso;
}

export interface Motor {
  sync: MotorSync;
  almacen: AlmacenDexie;
}

export function crearMotor(sesion: DatosSesion): Motor {
  acceso = sesion.acceso;
  localStorage.setItem('lena.refresh', sesion.refresh);

  const almacen = new AlmacenDexie();
  const transporte = new TransporteHttp('', tokenAcceso);
  const sync = new MotorSync(almacen, transporte, {
    sucursalId: sesion.sesion.sucursalId as string,
    dispositivoId: sesion.sesion.dispositivoId as string,
  });
  return { sync, almacen };
}

// Intenta reanudar la sesión con el refresh guardado (sesión persistente,
// RS-A-8). Devuelve la sesión o null si ya no vale.
export async function reanudar(): Promise<DatosSesion | null> {
  const guardado = localStorage.getItem('lena.refresh');
  if (!guardado) return null;
  try {
    const datos = await refrescar(guardado);
    return datos;
  } catch {
    localStorage.removeItem('lena.refresh');
    return null;
  }
}

export function cerrarSesion(): void {
  acceso = null;
  localStorage.removeItem('lena.refresh');
}
