// Foto di esempio: un ritratto in controluce in spiaggia (soggetto scuro, cielo e sabbia chiari)
// disegnato su canvas. Serve per provare editor e stampa senza fotocamera e per mostrare a cosa
// serve il controluce automatico: il viso è scuro ma ha i dettagli, che le regolazioni recuperano.
// Le proporzioni sono pensate perché Backlight lo riconosca in tutti i modelli (Polaroid,
// Pieno, Striscia): soggetto grande al centro, angoli quasi bianchi.

/** Disegna la scena su un contesto 2D di [width] x [height] pixel. Funzione pura sul contesto. */
export function drawSamplePhoto(ctx, width, height) {
  const w = width;
  const h = height;

  // Cielo: azzurro chiarissimo in alto, bianco all'orizzonte (è lui che fa il controluce).
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.74);
  sky.addColorStop(0, '#d2ecff');
  sky.addColorStop(0.6, '#f1f9ff');
  sky.addColorStop(1, '#ffffff');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // Sole alle spalle del soggetto: un grande alone bianco.
  const sunX = w * 0.78;
  const sunY = h * 0.16;
  const sun = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, w * 0.5);
  sun.addColorStop(0, 'rgba(255,255,255,1)');
  sun.addColorStop(0.25, 'rgba(255,254,240,0.95)');
  sun.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, w, h);

  // Due palloncini da festa: toni medi, sulla carta diventano grigi retinati.
  balloon(ctx, w * 0.12, h * 0.17, w * 0.06, '#ff9a88', w * 0.17, h * 0.36);
  balloon(ctx, w * 0.24, h * 0.1, w * 0.05, '#ffd75e', w * 0.2, h * 0.34);

  // Mare lontano, sottile, e sabbia chiarissima.
  ctx.fillStyle = '#cfe3ee';
  ctx.fillRect(0, h * 0.72, w, h * 0.03);
  const sand = ctx.createLinearGradient(0, h * 0.75, 0, h);
  sand.addColorStop(0, '#fbf7ee');
  sand.addColorStop(1, '#f1ead9');
  ctx.fillStyle = sand;
  ctx.fillRect(0, h * 0.75, w, h * 0.25);

  const cx = w * 0.5;
  const headY = h * 0.42;
  const headRx = w * 0.25;
  const headRy = h * 0.19;
  const shoulderY = h * 0.62;

  // Spalle e busto: scuri, più stretti della foto, così gli angoli in basso restano chiari.
  const body = ctx.createLinearGradient(0, shoulderY, 0, h);
  body.addColorStop(0, '#3b312a');
  body.addColorStop(1, '#251f1b');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.36, h);
  ctx.bezierCurveTo(cx - w * 0.36, h * 0.74, cx - w * 0.26, shoulderY, cx - w * 0.1, shoulderY - h * 0.005);
  ctx.lineTo(cx + w * 0.1, shoulderY - h * 0.005);
  ctx.bezierCurveTo(cx + w * 0.26, shoulderY, cx + w * 0.36, h * 0.74, cx + w * 0.36, h);
  ctx.closePath();
  ctx.fill();
  // Colletto a V della maglietta, un poco più chiaro: un dettaglio da ritrovare.
  ctx.fillStyle = '#4e4138';
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.09, shoulderY);
  ctx.lineTo(cx, h * 0.7);
  ctx.lineTo(cx + w * 0.09, shoulderY);
  ctx.closePath();
  ctx.fill();

  // Collo.
  ctx.fillStyle = '#45372e';
  ctx.fillRect(cx - w * 0.08, headY + headRy * 0.6, w * 0.16, shoulderY - (headY + headRy * 0.6) + 4);

  // Bordo di luce attorno alla testa (il sole è dietro).
  ctx.fillStyle = 'rgba(255,250,235,0.6)';
  ellipse(ctx, cx, headY, headRx + w * 0.01, headRy + w * 0.01);

  // Viso in ombra: marrone scuro con una sfumatura più chiara a sinistra.
  const face = ctx.createRadialGradient(cx - headRx * 0.35, headY - headRy * 0.05, headRx * 0.1, cx, headY, headRx * 1.15);
  face.addColorStop(0, '#6a5444');
  face.addColorStop(1, '#3c3028');
  ctx.fillStyle = face;
  ellipse(ctx, cx, headY, headRx, headRy);

  // Orecchie.
  ctx.fillStyle = '#463830';
  ellipse(ctx, cx - headRx * 0.98, headY + headRy * 0.05, headRx * 0.13, headRy * 0.16);
  ellipse(ctx, cx + headRx * 0.98, headY + headRy * 0.05, headRx * 0.13, headRy * 0.16);

  // Capelli: una calotta scura con la frangia.
  ctx.fillStyle = '#1f1915';
  ctx.beginPath();
  ctx.ellipse(cx, headY - headRy * 0.1, headRx * 1.06, headRy * 0.98, 0, Math.PI, 2 * Math.PI);
  ctx.bezierCurveTo(cx + headRx * 0.9, headY - headRy * 0.04, cx + headRx * 0.4, headY - headRy * 0.4, cx, headY - headRy * 0.38);
  ctx.bezierCurveTo(cx - headRx * 0.45, headY - headRy * 0.36, cx - headRx * 0.85, headY, cx - headRx * 1.06, headY - headRy * 0.1);
  ctx.closePath();
  ctx.fill();

  // Guance appena più chiare.
  ctx.fillStyle = 'rgba(150,100,85,0.35)';
  ellipse(ctx, cx - headRx * 0.52, headY + headRy * 0.3, headRx * 0.2, headRy * 0.12);
  ellipse(ctx, cx + headRx * 0.52, headY + headRy * 0.3, headRx * 0.2, headRy * 0.12);

  // Occhi con un puntino di luce e sopracciglia.
  const eyeY = headY + headRy * 0.04;
  for (const side of [-1, 1]) {
    const ex = cx + side * headRx * 0.38;
    ctx.fillStyle = '#17110d';
    ellipse(ctx, ex, eyeY, headRx * 0.1, headRy * 0.1);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ellipse(ctx, ex + headRx * 0.03, eyeY - headRy * 0.03, headRx * 0.03, headRx * 0.03);
    ctx.strokeStyle = '#1a1410';
    ctx.lineWidth = w * 0.014;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ex - side * headRx * 0.14, eyeY - headRy * 0.2);
    ctx.quadraticCurveTo(ex, eyeY - headRy * 0.27, ex + side * headRx * 0.15, eyeY - headRy * 0.19);
    ctx.stroke();
  }

  // Naso, appena accennato.
  ctx.strokeStyle = 'rgba(30,22,18,0.6)';
  ctx.lineWidth = w * 0.01;
  ctx.beginPath();
  ctx.moveTo(cx + headRx * 0.02, headY + headRy * 0.14);
  ctx.quadraticCurveTo(cx + headRx * 0.12, headY + headRy * 0.28, cx - headRx * 0.04, headY + headRy * 0.32);
  ctx.stroke();

  // Il sorriso: bocca aperta con i denti chiari.
  const mouthY = headY + headRy * 0.48;
  ctx.fillStyle = '#1b120f';
  ctx.beginPath();
  ctx.moveTo(cx - headRx * 0.42, mouthY - headRy * 0.04);
  ctx.quadraticCurveTo(cx, mouthY + headRy * 0.36, cx + headRx * 0.42, mouthY - headRy * 0.04);
  ctx.quadraticCurveTo(cx, mouthY + headRy * 0.06, cx - headRx * 0.42, mouthY - headRy * 0.04);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#d9cfc4';
  ctx.beginPath();
  ctx.moveTo(cx - headRx * 0.3, mouthY + headRy * 0.02);
  ctx.quadraticCurveTo(cx, mouthY + headRy * 0.1, cx + headRx * 0.3, mouthY + headRy * 0.02);
  ctx.lineTo(cx + headRx * 0.26, mouthY + headRy * 0.08);
  ctx.quadraticCurveTo(cx, mouthY + headRy * 0.14, cx - headRx * 0.26, mouthY + headRy * 0.08);
  ctx.closePath();
  ctx.fill();
}

/**
 * Crea la foto di esempio come ImageBitmap (3:4, come lo scatto del telefono).
 * Usa OffscreenCanvas dove c'è, altrimenti un canvas del documento.
 */
export async function createSamplePhoto({ width = 1200, height = 1600 } = {}) {
  const w = Math.max(64, Math.round(width));
  const h = Math.max(64, Math.round(height));
  const canvas = typeof OffscreenCanvas === 'function'
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d non disponibile');
  drawSamplePhoto(ctx, w, h);
  return createImageBitmap(canvas);
}

function ellipse(ctx, x, y, rx, ry) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, 2 * Math.PI);
  ctx.fill();
}

/** Palloncino con riflesso e filo che scende fino a ([sx], [sy]). */
function balloon(ctx, x, y, r, color, sx, sy) {
  ctx.strokeStyle = 'rgba(80,80,80,0.6)';
  ctx.lineWidth = Math.max(1, r * 0.04);
  ctx.beginPath();
  ctx.moveTo(x, y + r * 1.2);
  ctx.quadraticCurveTo(x - r * 0.4, (y + sy) / 2, sx, sy);
  ctx.stroke();
  ctx.fillStyle = color;
  ellipse(ctx, x, y, r, r * 1.2);
  ctx.beginPath();
  ctx.moveTo(x - r * 0.15, y + r * 1.32);
  ctx.lineTo(x + r * 0.15, y + r * 1.32);
  ctx.lineTo(x, y + r * 1.15);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ellipse(ctx, x - r * 0.35, y - r * 0.45, r * 0.18, r * 0.28);
}
