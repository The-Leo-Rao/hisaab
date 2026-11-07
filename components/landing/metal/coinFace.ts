export function drawCoinFace(text: string, family: string, size = 1024): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, size, size);
  const mid = size / 2;
  const radius = size * 0.3;
  const px = Math.round(size * 0.044);
  g.font = `600 ${px}px ${family}`;
  g.fillStyle = "#fff";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.shadowColor = "#fff";
  g.shadowBlur = size * 0.002;
  const tracking = px * 0.32;
  const widths = [...text].map((ch) => g.measureText(ch).width + tracking);
  const total = widths.reduce((s, w) => s + w, 0) - tracking;
  let angle = Math.PI / 2 + total / radius / 2;
  for (const [i, ch] of [...text].entries()) {
    const step = widths[i] / radius;
    const at = angle - (widths[i] - tracking) / radius / 2;
    g.save();
    g.translate(mid + Math.cos(at) * radius, mid + Math.sin(at) * radius);
    g.rotate(at - Math.PI / 2);
    g.fillText(ch, 0, 0);
    g.restore();
    angle -= step;
  }
  return c;
}
