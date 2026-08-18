/**
 * Chirrido corto por Web Audio, sin archivos de audio.
 *
 * Detrás de la barra y en la cocina hay ruido: la señal visual sola no alcanza
 * para que alguien levante la vista.
 */
export function playBeep(fromHz = 880, toHz = 1320, seconds = 0.36): void {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;

    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(fromHz, ctx.currentTime);
    osc.frequency.setValueAtTime(toHz, ctx.currentTime + seconds / 3);

    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + seconds);

    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + seconds + 0.01);
    osc.onended = () => void ctx.close();
  } catch {
    // Si el navegador bloquea el audio hasta la primera interacción, da igual:
    // la señal visual sigue apareciendo.
  }
}
