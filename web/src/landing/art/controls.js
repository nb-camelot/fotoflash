// Controlli delle animazioni: pausa/riprendi (WCAG 2.2.2: ciò che si muove da solo per più di
// 5 secondi si deve poter fermare) e le frecce del carosello. Icone SVG statiche, decorative.

const PATHS = {
  pause: '<path d="M8.5 5.5v13M15.5 5.5v13"/>',
  play: '<path d="M8 5.2v13.6L19 12z" fill="currentColor"/>',
  prev: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  next: '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
};

/** Icona dei controlli (aria-hidden): l'etichetta la porta il pulsante. */
export function controlIcon(doc, name) {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '22');
  svg.setAttribute('height', '22');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = PATHS[name] || '';
  return svg;
}

/** Pulsante tondo dei controlli con icona ed etichetta per i lettori di schermo. */
export function controlButton(doc, name, label, onClick, cls = '') {
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = `ffx-btn ${cls}`.trim();
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.appendChild(controlIcon(doc, name));
  btn.addEventListener('click', onClick);
  return btn;
}

/**
 * Pausa/riprendi: l'etichetta dice cosa farà il tocco ('scene_pause' o 'scene_play').
 * onToggle(paused) a ogni tocco. → { el, set(paused), destroy() }
 */
export function pauseButton(doc, t, onToggle, cls = 'ffx-pause') {
  let paused = false;
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = `ffx-btn ${cls}`;
  function render() {
    const label = paused ? t('scene_play') : t('scene_pause');
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.replaceChildren(controlIcon(doc, paused ? 'play' : 'pause'));
  }
  const onClick = () => {
    paused = !paused;
    render();
    onToggle(paused);
  };
  btn.addEventListener('click', onClick);
  render();
  return {
    el: btn,
    get paused() {
      return paused;
    },
    set(value) {
      paused = Boolean(value);
      render();
    },
    destroy() {
      btn.removeEventListener('click', onClick);
    },
  };
}
