// Orologio delle animazioni della presentazione. Ogni illustrazione è una storia in loop divisa in
// "battute" (flash → stampa → reazione): il JS tiene il tempo e dice quale battuta è in corso, il CSS
// muove le parti con transizioni e keyframe su transform e opacity. Qui solo funzioni pure e un
// ciclo requestAnimationFrame con orologio e frame iniettabili (così si prova in Node).

/**
 * Controlla e congela una sequenza: { duration, beats: [['id', inizioMs], ...] }.
 * La prima battuta parte da 0, gli inizi crescono e stanno dentro la durata.
 */
export function timeline(duration, beats) {
  if (!(Number.isFinite(duration) && duration > 0)) throw new RangeError(`durata non valida: ${duration}`);
  if (!Array.isArray(beats) || beats.length === 0) throw new RangeError('servono delle battute');
  let prev = -1;
  const ids = new Set();
  const list = beats.map(([id, at], i) => {
    if (typeof id !== 'string' || !/^[a-z][a-z0-9]*$/.test(id)) throw new RangeError(`battuta ${i}: nome non valido`);
    if (ids.has(id)) throw new RangeError(`battuta ripetuta: ${id}`);
    if (i === 0 && at !== 0) throw new RangeError('la prima battuta parte da 0');
    if (!(Number.isFinite(at) && at > prev && at < duration)) throw new RangeError(`battuta ${id}: inizio ${at} fuori ordine`);
    ids.add(id);
    prev = at;
    return Object.freeze([id, at]);
  });
  return Object.freeze({ duration, beats: Object.freeze(list) });
}

/** Indice dell'ultima battuta già iniziata al tempo [t] del giro (0 ≤ t < durata). */
export function beatIndexAt(beats, t) {
  let index = 0;
  for (let i = 1; i < beats.length; i++) {
    if (beats[i][1] <= t) index = i;
    else break;
  }
  return index;
}

/**
 * Dove siamo dopo [elapsed] ms di riproduzione: giro, tempo nel giro, battuta corrente, tempo
 * dall'inizio della battuta e avanzamento del giro (0..1).
 */
export function beatAt(tl, elapsed) {
  const e = Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0;
  const loop = Math.floor(e / tl.duration);
  const t = e - loop * tl.duration;
  const index = beatIndexAt(tl.beats, t);
  const [id, at] = tl.beats[index];
  const end = index + 1 < tl.beats.length ? tl.beats[index + 1][1] : tl.duration;
  return { loop, t, index, id, local: t - at, span: end - at, progress: t / tl.duration };
}

/** Classi cumulative delle battute raggiunte: ['b-pose', 'b-snap', ...] fino a [index] compreso. */
export function beatClasses(tl, index) {
  const last = Math.max(0, Math.min(tl.beats.length - 1, index));
  return tl.beats.slice(0, last + 1).map(([id]) => `b-${id}`);
}

/**
 * Fotogramma "finale" per chi riduce le animazioni: l'ultima battuta prima di quella di uscita
 * (che per convenzione si chiama 'out' e riporta la scena al punto di partenza).
 */
export function restingIndex(tl) {
  const n = tl.beats.length;
  return tl.beats[n - 1][0] === 'out' && n > 1 ? n - 2 : n - 1;
}

/**
 * Righe stampate dalla testina dopo [elapsed] ms: la stampa parte a [start], dura [duration] e
 * avanza a gradini di [band] righe, come il motore passo-passo della stampante. 0..rows.
 */
export function revealRows(elapsed, { start = 0, duration, rows, band = 1 }) {
  const total = Math.max(0, Math.floor(rows));
  if (!(duration > 0) || total === 0) return total;
  if (!(elapsed > start)) return 0;
  if (elapsed >= start + duration) return total;
  const step = Math.max(1, Math.floor(band));
  const raw = Math.floor(((elapsed - start) / duration) * total);
  return Math.min(total, Math.floor(raw / step) * step);
}

/**
 * Ciclo di riproduzione. onBeat(info, { wrapped }) a ogni cambio di battuta (wrapped: è
 * ricominciato il giro), onFrame(info) a ogni fotogramma. Il tempo avanza solo mentre suona, e un
 * salto fra due fotogrammi conta al massimo [maxStep] ms: tornando su una scheda non si "salta" la
 * storia. raf/caf/now si possono sostituire nei test.
 */
export function createLoop(tl, { onBeat, onFrame, raf, caf, now, maxStep = 100 } = {}) {
  const request = raf || ((fn) => globalThis.requestAnimationFrame(fn));
  const cancel = caf || ((id) => globalThis.cancelAnimationFrame(id));
  const clock = now || (() => globalThis.performance.now());
  let elapsed = 0;
  let last = 0;
  let frame = 0;
  let playing = false;
  let current = null; // { loop, index } dell'ultima battuta annunciata

  function emit(force) {
    const info = beatAt(tl, elapsed);
    if (force || !current || current.loop !== info.loop || current.index !== info.index) {
      const wrapped = !force && current !== null && info.loop !== current.loop;
      current = { loop: info.loop, index: info.index };
      if (onBeat) onBeat(info, { wrapped });
    }
    if (onFrame) onFrame(info);
    return info;
  }

  function tick() {
    frame = 0;
    if (!playing) return;
    const n = clock();
    elapsed += Math.max(0, Math.min(maxStep, n - last));
    last = n;
    emit(false);
    if (playing && !frame) frame = request(tick);
  }

  return {
    play() {
      if (playing) return;
      playing = true;
      last = clock();
      if (current === null) emit(true);
      frame = request(tick);
    },
    pause() {
      playing = false;
      if (frame) cancel(frame);
      frame = 0;
    },
    /** Torna all'inizio del giro (e lo annuncia), suonando o no. */
    restart() {
      elapsed = 0;
      current = null;
      last = clock();
      emit(true);
    },
    /** Salta a [ms] dall'inizio (per i test e per il fotogramma fermo). */
    seek(ms) {
      elapsed = Math.max(0, ms);
      current = null;
      emit(true);
    },
    get playing() {
      return playing;
    },
    get elapsed() {
      return elapsed;
    },
    destroy() {
      this.pause();
    },
  };
}
