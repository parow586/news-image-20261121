// The World in One Day — Saturday 21 November 2026
// A program that draws one 1024x1024 news poster with no network and no
// external files. Every pixel is computed here: a small framebuffer, a
// hand-made 5x7 bitmap font, and flat geometric illustrations drawn from
// the verified stories in VERIFICATION.md. Deterministic: same bytes
// every run. Node 22, standard library only.

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

const W = 1024;
const H = 1024;

// ---- palette: one restrained broadsheet set, chosen for this poster ----
const PAPER = [247, 242, 231];
const INK = [20, 24, 34];
const NAVY = [20, 38, 74];
const NAVY2 = [28, 52, 96];
const GOLD = [198, 148, 52];
const CREAM = [250, 246, 236];
const RED = [178, 44, 36];
const TEAL = [31, 110, 104];
const SKY = [126, 166, 198];
const DUSK = [214, 138, 74];
const GREEN = [46, 110, 66];
const GREY = [110, 112, 118];

// ---- framebuffer: plain RGB rows, (0,0) top-left ----
const fb = new Uint8Array(W * H * 3);

function rgb(c: number[]): [number, number, number] {
  return [c[0], c[1], c[2]];
}

function setPx(x: number, y: number, c: number[]): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  fb[i] = c[0];
  fb[i + 1] = c[1];
  fb[i + 2] = c[2];
}

function fillRect(x: number, y: number, w: number, h: number, c: number[]): void {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(W, x + w);
  const y1 = Math.min(H, y + h);
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) setPx(xx, yy, c);
  }
}

function vgrad(x: number, y: number, w: number, h: number, top: number[], bot: number[]): void {
  for (let yy = 0; yy < h; yy++) {
    const t = h <= 1 ? 0 : yy / (h - 1);
    const c = [
      Math.round(top[0] + (bot[0] - top[0]) * t),
      Math.round(top[1] + (bot[1] - top[1]) * t),
      Math.round(top[2] + (bot[2] - top[2]) * t),
    ];
    fillRect(x, y + yy, w, 1, c);
  }
}

function hline(x: number, y: number, len: number, c: number[]): void {
  fillRect(x, y, len, 1, c);
}

function vline(x: number, y: number, len: number, c: number[]): void {
  fillRect(x, y, 1, len, c);
}

// Bresenham line, 1px wide.
function line(x0: number, y0: number, x1: number, y1: number, c: number[]): void {
  let dx = Math.abs(x1 - x0);
  let dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    setPx(x, y, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

function fillCircle(cx: number, cy: number, r: number, c: number[]): void {
  for (let yy = -r; yy <= r; yy++) {
    const half = Math.floor(Math.sqrt(r * r - yy * yy));
    fillRect(cx - half, cy + yy, half * 2 + 1, 1, c);
  }
}

function ring(cx: number, cy: number, r: number, c: number[]): void {
  for (let a = 0; a < 360; a += 1) {
    const rad = (a * Math.PI) / 180;
    setPx(Math.round(cx + r * Math.cos(rad)), Math.round(cy + r * Math.sin(rad)), c);
  }
}

// Filled triangle by scanline interpolation.
function fillTri(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, c: number[]): void {
  const minY = Math.max(0, Math.min(ay, by, cy));
  const maxY = Math.min(H - 1, Math.max(ay, by, cy));
  for (let y = minY; y <= maxY; y++) {
    const xs: number[] = [];
    const edges: [number, number, number, number][] = [
      [ax, ay, bx, by],
      [bx, by, cx, cy],
      [cx, cy, ax, ay],
    ];
    for (const [x1, y1, x2, y2] of edges) {
      if ((y1 <= y && y < y2) || (y2 <= y && y < y1)) {
        const t = (y - y1) / (y2 - y1);
        xs.push(Math.round(x1 + t * (x2 - x1)));
      }
    }
    if (xs.length >= 2) {
      const lo = Math.min(...xs);
      const hi = Math.max(...xs);
      fillRect(lo, y, hi - lo + 1, 1, c);
    }
  }
}

// ---- PNG writing (stdlib zlib; filter 0 rows; CRC32 table built once) ----
const CRC_TABLE: number[] = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t.push(c >>> 0);
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

function writePng(outPath: string): void {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0;
    raw.set(fb.subarray(y * W * 3, (y + 1) * W * 3), y * (1 + W * 3) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, png);
}

// ---- 5x7 bitmap font (authored here; rows are 5-bit values, bit 4 = left) ----
const FONT: Record<string, number[]> = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0a],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  "0": [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  "1": [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  "2": [0x0e, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1f],
  "3": [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  "4": [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  "5": [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  "6": [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  "7": [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  "8": [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  "9": [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  " ": [0, 0, 0, 0, 0, 0, 0],
  ".": [0, 0, 0, 0, 0, 0x0c, 0x0c],
  ",": [0, 0, 0, 0, 0x0c, 0x04, 0x08],
  ":": [0, 0x0c, 0x0c, 0, 0x0c, 0x0c, 0],
  ";": [0, 0x0c, 0x0c, 0, 0x0c, 0x04, 0x08],
  "!": [0x04, 0x04, 0x04, 0x04, 0x04, 0x00, 0x04],
  "?": [0x0e, 0x11, 0x01, 0x06, 0x04, 0x00, 0x04],
  "'": [0x04, 0x04, 0x08, 0, 0, 0, 0],
  "-": [0, 0, 0, 0x1f, 0, 0, 0],
  "/": [0x01, 0x01, 0x02, 0x04, 0x08, 0x10, 0x10],
  "(": [0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02],
  ")": [0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08],
  "%": [0x19, 0x19, 0x02, 0x04, 0x08, 0x13, 0x13],
  "+": [0, 0x04, 0x04, 0x1f, 0x04, 0x04, 0],
  "=": [0, 0, 0x1f, 0, 0x1f, 0, 0],
  "*": [0, 0x04, 0x15, 0x0e, 0x15, 0x04, 0],
  "&": [0x0c, 0x12, 0x14, 0x08, 0x15, 0x12, 0x0d],
  '"': [0x0a, 0x0a, 0x0a, 0, 0, 0, 0],
  "#": [0x0a, 0x0a, 0x1f, 0x0a, 0x1f, 0x0a, 0x0a],
  _: [0, 0, 0, 0, 0, 0, 0x1f],
};

function charW(scale: number): number {
  return 5 * scale + scale;
}

function textW(s: string, scale: number): number {
  return s.length * charW(scale) - scale;
}

function drawChar(ch: string, x: number, y: number, scale: number, c: number[]): void {
  const g = FONT[ch.toUpperCase()] ?? FONT["?"];
  for (let r = 0; r < 7; r++) {
    for (let col = 0; col < 5; col++) {
      if ((g[r] >> (4 - col)) & 1) fillRect(x + col * scale, y + r * scale, scale, scale, c);
    }
  }
}

function drawText(s: string, x: number, y: number, scale: number, c: number[]): void {
  for (let i = 0; i < s.length; i++) drawChar(s[i], x + i * charW(scale), y, scale, c);
}

function drawTextCentered(s: string, cx: number, y: number, scale: number, c: number[]): void {
  drawText(s, cx - Math.floor(textW(s, scale) / 2), y, scale, c);
}

// Greedy word wrap to maxWidth pixels; returns the lines.
function wrap(s: string, scale: number, maxWidth: number): string[] {
  const words = s.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur === "" ? w : cur + " " + w;
    if (textW(trial, scale) <= maxWidth) {
      cur = trial;
    } else {
      if (cur !== "") lines.push(cur);
      cur = w;
    }
  }
  if (cur !== "") lines.push(cur);
  return lines;
}

function drawPara(s: string, x: number, y: number, scale: number, maxWidth: number, c: number[], leading: number): number {
  const lines = wrap(s, scale, maxWidth);
  for (let i = 0; i < lines.length; i++) drawText(lines[i], x, y + i * leading, scale, c);
  return y + lines.length * leading;
}

// ---- illustrations: flat geometric scenes, one per story ----

// Four-point compass star (NATO-style emblem, drawn from geometry).
function compassStar(cx: number, cy: number, r: number, c: number[]): void {
  fillTri(cx, cy - r, cx + Math.round(r * 0.22), cy - Math.round(r * 0.22), cx, cy, c);
  fillTri(cx + r, cy, cx + Math.round(r * 0.22), cy + Math.round(r * 0.22), cx, cy, c);
  fillTri(cx, cy + r, cx - Math.round(r * 0.22), cy + Math.round(r * 0.22), cx, cy, c);
  fillTri(cx - r, cy, cx - Math.round(r * 0.22), cy - Math.round(r * 0.22), cx, cy, c);
}

function jet(x: number, y: number, s: number, c: number[]): void {
  fillTri(x, y, x + s, y + Math.round(s * 0.28), x, y + Math.round(s * 0.55), c);
  line(x - Math.round(s * 2.2), y + Math.round(s * 0.28), x, y + Math.round(s * 0.28), [250, 246, 236]);
}

function skyline(x: number, y: number, w: number, h: number, base: number, c: number[]): void {
  // Deterministic pseudo-random rooftops from a fixed seed sequence.
  let seed = 1234567;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  let cx = x;
  while (cx < x + w - 18) {
    const bw = 22 + Math.floor(rnd() * 34);
    const bh = Math.floor(h * (0.25 + rnd() * 0.55));
    fillRect(cx, base - bh, bw, bh, c);
    if (rnd() > 0.6) fillTri(cx, base - bh, cx + Math.floor(bw / 2), base - bh - 12, cx + bw, base - bh, c);
    cx += bw + 4;
  }
}

// Hero: Warsaw at dusk, NATO star, jets overhead.
function drawWarsaw(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, h, [16, 30, 62], [214, 138, 74]);
  fillCircle(x + Math.round(w * 0.72), y + Math.round(h * 0.62), 26, [250, 214, 140]);
  const base = y + h;
  skyline(x, y, w, h, base, [20, 24, 34]);
  // Tall stepped tower with a spire, centre-left.
  const tx = x + Math.round(w * 0.30);
  fillRect(tx - 34, base - 150, 68, 150, [20, 24, 34]);
  fillRect(tx - 24, base - 178, 48, 30, [20, 24, 34]);
  fillRect(tx - 12, base - 200, 24, 24, [20, 24, 34]);
  line(tx, base - 200, tx, base - 238, [20, 24, 34]);
  fillCircle(tx, base - 240, 3, [198, 148, 52]);
  // Lit windows: fixed grid, every third one lit.
  for (let wy = base - 142; wy < base - 12; wy += 14) {
    for (let wx = tx - 28; wx < tx + 28; wx += 12) {
      if (((wx * 7 + wy * 13) % 3) === 0) fillRect(wx, wy, 5, 7, [250, 214, 140]);
    }
  }
  // Red alert arc over the rooftops.
  for (let a = 200; a <= 340; a += 2) {
    const rad = (a * Math.PI) / 180;
    for (let rr = 148; rr <= 152; rr++) {
      setPx(Math.round(tx + rr * Math.cos(rad)), Math.round(base - 96 + 60 * Math.sin(rad)), RED);
    }
  }
  jet(x + 40, y + 34, 22, [250, 246, 236]);
  jet(x + 150, y + 62, 16, [250, 246, 236]);
  // NATO star badge, top right.
  fillCircle(x + w - 52, y + 48, 30, [250, 246, 236]);
  ring(x + w - 52, y + 48, 30, GOLD);
  compassStar(x + w - 52, y + 48, 24, NAVY);
}

// Riyadh: night tower, alert rings, interceptor streak.
function drawRiyadh(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, h, [10, 18, 40], [52, 66, 96]);
  fillCircle(x + 24, y + 22, 10, [250, 246, 236]);
  const base = y + h;
  const tx = x + Math.round(w * 0.62);
  // Tapering tower: stacked narrowing rects.
  fillRect(tx - 16, base - 96, 32, 96, [20, 24, 34]);
  fillRect(tx - 11, base - 118, 22, 22, [20, 24, 34]);
  fillRect(tx - 6, base - 132, 12, 14, [20, 24, 34]);
  for (let wy = base - 90; wy < base - 8; wy += 12) fillRect(tx - 2, wy, 4, 6, [250, 214, 140]);
  // Lower blocks.
  fillRect(x + 8, base - 44, 30, 44, [20, 24, 34]);
  fillRect(x + 44, base - 60, 26, 60, [20, 24, 34]);
  fillRect(x + w - 44, base - 52, 36, 52, [20, 24, 34]);
  // Alert rings around the tower crown.
  ring(tx, base - 132, 20, GOLD);
  ring(tx, base - 132, 28, RED);
  ring(tx, base - 132, 36, [250, 246, 236]);
  // Interceptor streak + smoke dots.
  line(x + 6, y + h - 30, x + 58, y + 26, [250, 246, 236]);
  fillCircle(x + 58, y + 26, 4, [250, 214, 140]);
  fillCircle(x + 30, y + 52, 3, [200, 200, 200]);
  fillCircle(x + 22, y + 62, 2, [200, 200, 200]);
}

// Wellington: green outfield, pitch, stumps, bat and ball.
function drawCricket(x: number, y: number, w: number, h: number): void {
  fillRect(x, y, w, h, [46, 110, 66]);
  fillRect(x, y, w, 10, [31, 110, 104]);
  // Pitch strip.
  fillRect(x + Math.round(w * 0.42), y + 12, Math.round(w * 0.16), h - 12, [214, 196, 158]);
  // Crease lines.
  hline(x + Math.round(w * 0.36), y + 26, Math.round(w * 0.28), CREAM);
  hline(x + Math.round(w * 0.36), y + h - 26, Math.round(w * 0.28), CREAM);
  // Stumps at both ends.
  for (const sy of [y + 30, y + h - 34]) {
    for (let i = 0; i < 3; i++) fillRect(x + Math.round(w * 0.46) + i * 6, sy, 3, 12, GOLD);
    fillRect(x + Math.round(w * 0.46), sy - 3, 15, 2, GOLD);
  }
  // Batsman: head, torso, legs, bat.
  const bx = x + Math.round(w * 0.50);
  const by = y + Math.round(h * 0.52);
  fillCircle(bx, by - 26, 7, [20, 24, 34]);
  fillRect(bx - 6, by - 18, 12, 22, CREAM);
  line(bx - 4, by + 4, bx - 8, by + 26, [20, 24, 34]);
  line(bx + 4, by + 4, bx + 9, by + 26, [20, 24, 34]);
  line(bx + 6, by - 12, bx + 22, by + 14, [214, 196, 158]);
  // Red ball with seam.
  fillCircle(x + w - 26, y + 26, 11, RED);
  for (let a = 20; a < 160; a += 14) {
    const rad = (a * Math.PI) / 180;
    setPx(Math.round(x + w - 26 + 8 * Math.cos(rad)), Math.round(y + 26 + 8 * Math.sin(rad)), CREAM);
  }
}

// Delhi: sandstone fort gate with domes and flags.
function drawDelhi(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, h, [250, 226, 178], [214, 138, 74]);
  fillCircle(x + w - 26, y + 24, 13, [250, 214, 140]);
  const base = y + h;
  // Fort wall and arched gate.
  fillRect(x + 6, base - 62, w - 12, 62, [146, 74, 44]);
  fillRect(x + Math.round(w * 0.38), base - 96, Math.round(w * 0.24), 96, [178, 102, 58]);
  fillCircle(x + Math.round(w * 0.50), base - 96, Math.round(w * 0.12), [178, 102, 58]);
  fillRect(x + Math.round(w * 0.44), base - 52, Math.round(w * 0.12), 52, [20, 24, 34]);
  fillCircle(x + Math.round(w * 0.50), base - 52, Math.round(w * 0.06), [20, 24, 34]);
  // Domes.
  fillCircle(x + 26, base - 62, 14, [178, 102, 58]);
  fillCircle(x + w - 26, base - 62, 14, [178, 102, 58]);
  // Three small flags: saffron / white / green bands.
  const flagCols = [[214, 138, 74], [250, 246, 236], [46, 110, 66]];
  for (let f = 0; f < 3; f++) {
    const fx = x + 14 + f * 16;
    vline(fx, base - 92, 30, [20, 24, 34]);
    for (let b = 0; b < 3; b++) fillRect(fx + 1, base - 92 + b * 5, 12, 5, flagCols[b]);
  }
}

// Sandpapergate: big red ball, seam, and a shield outline.
function drawBall(x: number, y: number, w: number, h: number): void {
  fillRect(x, y, w, h, TEAL);
  fillCircle(x + Math.round(w * 0.5), y + Math.round(h * 0.52), 44, [250, 246, 236]);
  fillCircle(x + Math.round(w * 0.5), y + Math.round(h * 0.52), 38, RED);
  // Seam: dashed curve across the ball.
  for (let a = 0; a < 360; a += 8) {
    const rad = (a * Math.PI) / 180;
    const px = Math.round(x + w * 0.5 + 26 * Math.cos(rad));
    const py = Math.round(y + h * 0.52 + 26 * Math.sin(rad) * 0.45);
    fillRect(px, py, 3, 3, CREAM);
  }
  // Small bat, lower right.
  line(x + w - 34, y + h - 44, x + w - 12, y + h - 12, [214, 196, 158]);
  fillRect(x + w - 40, y + h - 50, 8, 10, [214, 196, 158]);
}

// ---- layout: masthead, hero, four tiles, date check, footer ----
function drawMasthead(): void {
  fillRect(0, 0, W, 118, NAVY);
  fillRect(0, 118, W, 4, GOLD);
  drawTextCentered("THE WORLD IN ONE DAY", 512, 16, 5, CREAM);
  drawTextCentered("SATURDAY 21 NOVEMBER 2026", 512, 62, 3, GOLD);
  drawTextCentered("FIVE STORIES - ONE DAY - VERIFIED TO 21 NOV 2026", 512, 94, 1, [200, 205, 215]);
}

function drawHero(): void {
  const x = 24;
  const y = 132;
  const w = 976;
  const h = 318;
  fillRect(x, y, w, h, NAVY2);
  drawWarsaw(x, y, 536, h);
  vline(x + 544, y + 12, h - 24, GOLD);
  const tx = x + 568;
  const tw = 384;
  drawText("NATO - WARSAW - TODAY", tx, y + 18, 2, GOLD);
  drawPara("NATO CHIEF IN WARSAW TODAY", tx, y + 48, 3, tw, CREAM, 30);
  drawPara(
    "MARK RUTTE VISITS WARSAW ON SATURDAY AFTER RUSSIAN MISSILES FELL IN POLAND ON FRIDAY. WARSAW CALLS IT A PROVOCATION. NATO JETS SCRAMBLED. POLAND SEEKS MORE EASTERN SENTRY FORCES.",
    tx,
    y + 122,
    2,
    tw,
    [232, 236, 242],
    22,
  );
  drawText("SCHEDULED VISIT - TODAY, 21 NOV", tx, y + 282, 2, GOLD);
}

function drawTile(
  x: number,
  y: number,
  kicker: string,
  headline: string,
  body: string,
  art: (ax: number, ay: number, aw: number, ah: number) => void,
): void {
  const w = 482;
  const h = 167;
  fillRect(x, y, w, h, CREAM);
  // Border.
  fillRect(x, y, w, 2, INK);
  fillRect(x, y + h - 2, w, 2, INK);
  fillRect(x, y, 2, h, INK);
  fillRect(x + w - 2, y, 2, h, INK);
  art(x + 2, y + 2, 148, h - 4);
  const tx = x + 166;
  const tw = w - 182;
  drawText(kicker, tx, y + 12, 1, RED);
  drawPara(headline, tx, y + 30, 2, tw, INK, 20);
  drawPara(body, tx, y + 74, 2, tw, [52, 56, 66], 19);
}

function drawDateCheck(): void {
  const x = 24;
  const y = 814;
  const w = 976;
  const h = 136;
  fillRect(x, y, w, h, [255, 255, 255]);
  fillRect(x, y, w, 3, RED);
  fillRect(x, y + h - 3, w, 3, RED);
  fillRect(x, y, 3, h, RED);
  fillRect(x + w - 3, y, 3, h, RED);
  drawText("DATE CHECK - WHAT WE LEFT OUT", x + 14, y + 12, 2, RED);
  const lines = [
    "EXCLUDED - RUSSIAN MISSILES IN POLAND: 20 NOV - FELL FRIDAY, NOT TODAY.",
    "EXCLUDED - ICJ MYANMAR GENOCIDE RULING: 19 NOV - JUDGMENT READ THURSDAY.",
    "EXCLUDED - TRUMP-XI-PUTIN SUMMIT: 19 NOV - MET THURSDAY IN SHENZHEN.",
    "EXCLUDED - UK-EU RESET DEAL: 20 NOV - AGREED FRIDAY IN BRUSSELS.",
    "EXCLUDED - S&P 500 CORRECTION: 20 NOV - FRIDAY'S US CLOSE.",
    "EXCLUDED - TANKER FIRE, STRAIT OF HORMUZ: 20 NOV - STRUCK FRIDAY.",
    "EXCLUDED - CYCLONE AKVAN LANDFALL: 20 NOV - CROSSED COAST FRIDAY.",
    "EXCLUDED - GTA VI LAUNCH: 19 NOV - LAUNCHED THURSDAY.",
    "+ 14 MORE THURSDAY / FRIDAY STORIES CHECKED AND EXCLUDED - SEE VERIFICATION TABLE.",
  ];
  for (let i = 0; i < lines.length; i++) drawText(lines[i], x + 14, y + 34 + i * 11, 1, [52, 56, 66]);
}

function drawFooter(): void {
  fillRect(0, 962, W, 62, NAVY);
  fillRect(0, 962, W, 3, GOLD);
  drawTextCentered("EVERY STORY ABOVE HAPPENED OR WAS SCHEDULED FOR 21 NOV 2026.", 512, 974, 1, CREAM);
  drawTextCentered("SOURCES: REUTERS, AP, IANS, PIB, DEV DISCOURSE. DRAWN BY CODE - NO PHOTOS.", 512, 992, 1, [200, 205, 215]);
}

function main(): void {
  fillRect(0, 0, W, H, PAPER);
  drawMasthead();
  drawHero();
  drawTile(24, 462, "MIDDLE EAST - SATURDAY", "RIYADH ON ALERT",
    "TWO ALERTS IN RIYADH EARLY TODAY. COALITION SAYS 3 MISSILES INTERCEPTED. DANGER PASSED.",
    drawRiyadh);
  drawTile(518, 462, "CRICKET - WELLINGTON", "INDIA 239/1 AT LUNCH",
    "RAHUL 93 NOT OUT, PADIKKAL 53 NOT OUT ON DAY 3. NEW ZEALAND MADE 368.",
    drawCricket);
  drawTile(24, 637, "DIPLOMACY - DELHI", "SCO FORUM, DAY 2",
    "THEMATIC SESSIONS RUN IN DELHI TODAY, DAY 2 OF THE 20-22 NOV FORUM.",
    drawDelhi);
  drawTile(518, 637, "CRICKET - AUSTRALIA", "HAZLEWOOD BACKS CUMMINS",
    "IN A SATURDAY INTERVIEW HE DENIES SANDPAPER KNOWLEDGE. THE SCANDAL IS FROM 2018.",
    drawBall);
  drawDateCheck();
  drawFooter();
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  writePng(path.join(outDir, "entry.png"));
}

main();
