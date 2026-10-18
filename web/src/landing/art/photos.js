// "Foto" delle scene: piccoli disegni su canvas con sfumature, pensati per passare dal retino
// (thermal.js) e diventare stampe vere a pochi punti. Ogni funzione disegna su un contesto 2D di
// w x h pixel su fondo bianco; niente testo (sulla carta il testo non si retina mai).

function ellipse(ctx, x, y, rx, ry, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2);
  ctx.fill();
}

function vertical(ctx, w, h, top, bottom) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** Viso tondo con guance, occhi e bocca; [mood]: 'smile' | 'tongue' | 'laugh' | 'wink'. */
function face(ctx, x, y, r, { mood = 'smile', hair = '#2a221c', hat = false, skin = '#d9b896' } = {}) {
  const shade = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r * 1.1);
  shade.addColorStop(0, '#f2dcc4');
  shade.addColorStop(1, skin);
  ellipse(ctx, x, y, r, r, shade);
  // capelli: calotta scura
  ctx.fillStyle = hair;
  ctx.beginPath();
  ctx.ellipse(x, y - r * 0.18, r * 1.04, r * 0.9, 0, Math.PI * 1.02, Math.PI * 1.98);
  ctx.closePath();
  ctx.fill();
  if (hat) {
    // cappellino a cono con le righe e il pompon
    ctx.fillStyle = '#8a8a8a';
    ctx.beginPath();
    ctx.moveTo(x - r * 0.62, y - r * 0.72);
    ctx.lineTo(x + r * 0.62, y - r * 0.72);
    ctx.lineTo(x + r * 0.1, y - r * 2.1);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#2e2e2e';
    ctx.lineWidth = Math.max(1, r * 0.16);
    for (const k of [0.35, 0.7]) {
      const yy = y - r * 0.72 - k * r * 1.38;
      const half = r * 0.62 * (1 - k);
      ctx.beginPath();
      ctx.moveTo(x - half + k * r * 0.1, yy);
      ctx.lineTo(x + half + k * r * 0.1, yy);
      ctx.stroke();
    }
    ellipse(ctx, x + r * 0.1, y - r * 2.1, r * 0.22, r * 0.22, '#3a3a3a');
  }
  // guance
  ellipse(ctx, x - r * 0.55, y + r * 0.28, r * 0.2, r * 0.13, 'rgba(150,90,80,0.35)');
  ellipse(ctx, x + r * 0.55, y + r * 0.28, r * 0.2, r * 0.13, 'rgba(150,90,80,0.35)');
  // occhi
  ctx.fillStyle = '#16110d';
  ctx.strokeStyle = '#16110d';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1, r * 0.14);
  if (mood === 'laugh' || mood === 'wink') {
    for (const side of mood === 'laugh' ? [-1, 1] : [-1]) {
      ctx.beginPath();
      ctx.arc(x + side * r * 0.36, y - r * 0.02, r * 0.16, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    }
    if (mood === 'wink') ellipse(ctx, x + r * 0.36, y - r * 0.08, r * 0.12, r * 0.14, '#16110d');
  } else {
    ellipse(ctx, x - r * 0.36, y - r * 0.08, r * 0.12, r * 0.14, '#16110d');
    ellipse(ctx, x + r * 0.36, y - r * 0.08, r * 0.12, r * 0.14, '#16110d');
  }
  // bocca
  if (mood === 'laugh' || mood === 'tongue') {
    ctx.fillStyle = '#24140f';
    ctx.beginPath();
    ctx.moveTo(x - r * 0.42, y + r * 0.3);
    ctx.quadraticCurveTo(x, y + r * 0.95, x + r * 0.42, y + r * 0.3);
    ctx.closePath();
    ctx.fill();
    if (mood === 'tongue') ellipse(ctx, x + r * 0.08, y + r * 0.66, r * 0.2, r * 0.18, '#b46a62');
  } else {
    ctx.beginPath();
    ctx.arc(x, y + r * 0.2, r * 0.38, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
  }
}

/** Striscia della festa: due bambini col cappellino, tre pose (0 sorriso, 1 boccaccia, 2 risata). */
export function drawPartyFrame(pose) {
  return (ctx, w, h) => {
    vertical(ctx, w, h, '#cfcfcf', '#f7f7f7');
    // festoni sullo sfondo
    for (let i = 0; i < 6; i++) ellipse(ctx, (i + 0.5) * (w / 6), h * 0.1, w * 0.04, w * 0.04, i % 2 ? '#9a9a9a' : '#bdbdbd');
    const r = Math.min(w * 0.17, h * 0.24);
    const moods = [['smile', 'smile'], ['tongue', 'wink'], ['laugh', 'laugh']][pose % 3];
    // corpi
    ellipse(ctx, w * 0.3, h * 1.02, r * 1.3, r * 0.9, '#6b6b6b');
    ellipse(ctx, w * 0.7, h * 1.02, r * 1.3, r * 0.9, '#9c9c9c');
    const tilt = pose === 1 ? r * 0.25 : 0;
    face(ctx, w * 0.3, h * 0.6 - tilt, r, { mood: moods[0], hat: true });
    face(ctx, w * 0.7, h * 0.6 + tilt * 0.5, r, { mood: moods[1], hat: true, hair: '#5a4a3a' });
  };
}

/** Gli sposi: lui con i capelli scuri e il farfallino, lei con il velo; un cuore sopra. */
export function drawCouple(ctx, w, h) {
  vertical(ctx, w, h, '#d8d8d8', '#fbfbfb');
  const r = Math.min(w * 0.16, h * 0.2);
  // velo dietro la sposa
  ellipse(ctx, w * 0.68, h * 0.62, r * 1.6, r * 1.9, '#efefef');
  // abiti
  ellipse(ctx, w * 0.32, h * 1.05, r * 1.5, r * 1.1, '#2b2b2b');
  ellipse(ctx, w * 0.68, h * 1.05, r * 1.5, r * 1.1, '#f3f3f3');
  ctx.fillStyle = '#3c3c3c';
  ctx.beginPath();
  ctx.moveTo(w * 0.32, h * 0.86);
  ctx.lineTo(w * 0.32 - r * 0.45, h * 0.82);
  ctx.lineTo(w * 0.32 - r * 0.45, h * 0.92);
  ctx.closePath();
  ctx.moveTo(w * 0.32, h * 0.86);
  ctx.lineTo(w * 0.32 + r * 0.45, h * 0.82);
  ctx.lineTo(w * 0.32 + r * 0.45, h * 0.92);
  ctx.closePath();
  ctx.fill();
  face(ctx, w * 0.32, h * 0.56, r, { mood: 'smile', hair: '#1c1611' });
  face(ctx, w * 0.68, h * 0.56, r, { mood: 'smile', hair: '#7a6450' });
  // cuore
  const hx = w * 0.5;
  const hy = h * 0.2;
  const s = r * 0.5;
  ctx.fillStyle = '#4a4a4a';
  ctx.beginPath();
  ctx.moveTo(hx, hy + s * 0.9);
  ctx.bezierCurveTo(hx - s * 1.6, hy - s * 0.2, hx - s * 0.6, hy - s * 1.2, hx, hy - s * 0.3);
  ctx.bezierCurveTo(hx + s * 0.6, hy - s * 1.2, hx + s * 1.6, hy - s * 0.2, hx, hy + s * 0.9);
  ctx.fill();
}

/** Il cane: muso chiaro, orecchie scure a penzoloni, macchia sull'occhio, lingua fuori. */
export function drawDog(ctx, w, h) {
  // Fondo medio e testa chiara: a 48 punti il muso si stacca come una sagoma bianca sul puntinato
  // (con fondo e pelo tutti e due chiari il retino li confondeva e restavano solo occhi e orecchie).
  vertical(ctx, w, h, '#8f8f8f', '#c6c6c6');
  const cx = w * 0.5;
  const cy = h * 0.55;
  const r = Math.min(w, h) * 0.32;
  const fur = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.4, r * 0.1, cx, cy, r * 1.2);
  fur.addColorStop(0, '#fbf6f0');
  fur.addColorStop(1, '#d8cab9');
  ellipse(ctx, cx, cy, r, r * 0.92, fur);
  // orecchie a penzoloni davanti ai lati della testa, inclinate verso l'esterno
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(cx + side * r * 0.86, cy - r * 0.02);
    ctx.rotate(side * -0.35);
    ellipse(ctx, 0, 0, r * 0.3, r * 0.64, '#2e2722');
    ctx.restore();
  }
  // macchia sull'occhio
  ellipse(ctx, cx + r * 0.38, cy - r * 0.18, r * 0.3, r * 0.26, '#a8957f');
  // occhi
  ellipse(ctx, cx - r * 0.36, cy - r * 0.16, r * 0.12, r * 0.14, '#120d0a');
  ellipse(ctx, cx + r * 0.38, cy - r * 0.16, r * 0.12, r * 0.14, '#120d0a');
  // muso, naso e lingua
  ellipse(ctx, cx, cy + r * 0.36, r * 0.46, r * 0.32, '#efe6dc');
  ellipse(ctx, cx, cy + r * 0.2, r * 0.17, r * 0.12, '#120d0a');
  ellipse(ctx, cx + r * 0.05, cy + r * 0.66, r * 0.15, r * 0.2, '#a35b54');
}

/** Montagne innevate con il sole. */
export function drawMountains(ctx, w, h) {
  vertical(ctx, w, h, '#bfbfbf', '#f6f6f6');
  ellipse(ctx, w * 0.78, h * 0.25, w * 0.1, w * 0.1, '#ffffff');
  ctx.fillStyle = '#5a5a5a';
  ctx.beginPath();
  ctx.moveTo(-2, h);
  ctx.lineTo(w * 0.3, h * 0.32);
  ctx.lineTo(w * 0.55, h * 0.7);
  ctx.lineTo(w * 0.72, h * 0.48);
  ctx.lineTo(w + 2, h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#f2f2f2';
  ctx.beginPath();
  ctx.moveTo(w * 0.3, h * 0.32);
  ctx.lineTo(w * 0.22, h * 0.47);
  ctx.lineTo(w * 0.3, h * 0.43);
  ctx.lineTo(w * 0.37, h * 0.47);
  ctx.closePath();
  ctx.fill();
  const lake = ctx.createLinearGradient(0, h * 0.8, 0, h);
  lake.addColorStop(0, '#8d8d8d');
  lake.addColorStop(1, '#d6d6d6');
  ctx.fillStyle = lake;
  ctx.fillRect(0, h * 0.84, w, h * 0.16);
}

/** Spiaggia con la palma. */
export function drawBeach(ctx, w, h) {
  vertical(ctx, w, h, '#c4c4c4', '#fafafa');
  ellipse(ctx, w * 0.25, h * 0.28, w * 0.11, w * 0.11, '#ffffff');
  ctx.fillStyle = '#8c8c8c';
  ctx.fillRect(0, h * 0.62, w, h * 0.12);
  ctx.fillStyle = '#ece6da';
  ctx.fillRect(0, h * 0.74, w, h * 0.26);
  // tronco e foglie
  ctx.strokeStyle = '#3e3630';
  ctx.lineWidth = Math.max(1.5, w * 0.05);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(w * 0.7, h * 0.95);
  ctx.quadraticCurveTo(w * 0.74, h * 0.6, w * 0.64, h * 0.3);
  ctx.stroke();
  ctx.fillStyle = '#2a2622';
  for (const [dx, dy, rot] of [[-0.16, 0.02, -0.5], [0.16, 0.02, 0.5], [-0.1, -0.08, -1.1], [0.12, -0.08, 1.1]]) {
    ctx.save();
    ctx.translate(w * (0.64 + dx * 0.6), h * (0.3 + dy));
    ctx.rotate(rot);
    ellipse(ctx, 0, 0, w * 0.15, w * 0.05, '#2a2622');
    ctx.restore();
  }
}

/** Faro a righe sul mare. */
export function drawLighthouse(ctx, w, h) {
  // Cielo medio e torre con la sagoma scura continua: a 48 punti le fasce bianche si vedono solo
  // se staccano dal fondo, e i tratti scuri non devono restare blocchi separati.
  vertical(ctx, w, h, '#878787', '#c2c2c2');
  const x = w * 0.5;
  const top = h * 0.3;
  const bottom = h * 0.84;
  const halfAt = (y) => w * (0.085 + 0.055 * ((y - top) / (bottom - top)));
  const band = (y0, y1, inset, fill) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(x - halfAt(y0) + inset, y0);
    ctx.lineTo(x + halfAt(y0) - inset, y0);
    ctx.lineTo(x + halfAt(y1) - inset, y1);
    ctx.lineTo(x - halfAt(y1) + inset, y1);
    ctx.closePath();
    ctx.fill();
  };
  // fascio di luce verso destra, dietro la lanterna
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(x, top - h * 0.1);
  ctx.lineTo(w, top - h * 0.24);
  ctx.lineTo(w, top + h * 0.02);
  ctx.closePath();
  ctx.fill();
  // mare e scoglio
  ctx.fillStyle = '#5f5f5f';
  ctx.fillRect(0, h * 0.8, w, h * 0.2);
  ellipse(ctx, x, h * 0.86, w * 0.24, h * 0.07, '#2a2a2a');
  // torre: sagoma scura, poi due fasce bianche dentro
  band(top, bottom, 0, '#1e1e1e');
  const step = (bottom - top) / 5;
  for (const i of [1, 3]) band(top + step * i, top + step * (i + 1), w * 0.025, '#ffffff');
  // lanterna accesa con il tetto
  ctx.fillStyle = '#1e1e1e';
  ctx.fillRect(x - w * 0.1, top - h * 0.13, w * 0.2, h * 0.13);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x - w * 0.055, top - h * 0.1, w * 0.11, h * 0.07);
  ctx.fillStyle = '#1e1e1e';
  ctx.beginPath();
  ctx.moveTo(x - w * 0.13, top - h * 0.13);
  ctx.lineTo(x + w * 0.13, top - h * 0.13);
  ctx.lineTo(x, top - h * 0.24);
  ctx.closePath();
  ctx.fill();
}

/** Un ospite in fila: [variant] cambia capelli e tono della maglia. */
export function drawGuest(variant) {
  return (ctx, w, h) => {
    vertical(ctx, w, h, '#d0d0d0', '#f8f8f8');
    const r = Math.min(w, h) * 0.27;
    ellipse(ctx, w * 0.5, h * 1.02, r * 1.6, r * 1.05, ['#555555', '#8a8a8a', '#3a3a3a'][variant % 3]);
    face(ctx, w * 0.5, h * 0.52, r, { mood: variant === 1 ? 'laugh' : 'smile', hair: ['#1f1915', '#6a5644', '#2f2620'][variant % 3] });
  };
}
