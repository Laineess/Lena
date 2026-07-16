// Sonidos de cocina (09 §6.5). Cada evento suena distinto para que el cocinero
// sepa qué pasó sin voltear. Web Audio: sin archivos, se sintetiza al vuelo.
export type SonidoCocina = 'nueva' | 'regresa' | 'cancela' | 'tic';

let ctx: AudioContext | null = null;

// El navegador exige un gesto del usuario para arrancar el audio; se llama al
// primer toque (p. ej. al entrar a cocina).
export function desbloquearAudio(): void {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor) ctx = new Ctor();
  }
  void ctx?.resume();
}

function tono(frecuencia: number, inicio: number, duracion: number, volumen = 0.3): void {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = frecuencia;
  osc.type = 'sine';
  gain.gain.setValueAtTime(volumen, ctx.currentTime + inicio);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + inicio + duracion);
  osc.connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime + inicio);
  osc.stop(ctx.currentTime + inicio + duracion);
}

export function reproducir(tipo: SonidoCocina): void {
  if (!ctx) return;
  switch (tipo) {
    case 'nueva': // campana doble, 800 Hz
      tono(800, 0, 0.15);
      tono(800, 0.2, 0.15);
      break;
    case 'regresa': // triple ascendente, distinto de la nueva
      tono(700, 0, 0.12);
      tono(900, 0.15, 0.12);
      tono(1100, 0.3, 0.14);
      break;
    case 'cancela': // grave = malas noticias
      tono(300, 0, 0.4, 0.35);
      break;
    case 'tic': // umbral rojo, discreto
      tono(1200, 0, 0.05, 0.15);
      break;
  }
}
