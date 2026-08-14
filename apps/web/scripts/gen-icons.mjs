import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const LETTER_R = [
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1],
  [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1],
  [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1],
  [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1],
  [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1],
  [1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1],
  [1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1],
  [1, 1, 0, 1, 0, 0, 0, 0, 1, 0, 1, 1],
  [1, 1, 0, 1, 0, 0, 0, 0, 1, 0, 1, 1],
  [1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1],
  [1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
];

const GRID_W = 12;
const GRID_H = 16;

function inRect(px, py, size, radius) {
  const x = Math.abs(px - size / 2);
  const y = Math.abs(py - size / 2);
  const half = size / 2;
  if (x > half || y > half) return false;
  if (x <= half - radius || y <= half - radius) return true;
  const dx = x - (half - radius);
  const dy = y - (half - radius);
  return dx * dx + dy * dy <= radius * radius;
}

function renderIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const radius = size * 0.22;
  const cellW = (size * 0.52) / GRID_W;
  const cellH = (size * 0.52) / GRID_H;
  const originX = (size - GRID_W * cellW) / 2;
  const originY = (size - GRID_H * cellH) / 2;

  const teal = [14, 165, 164];
  const indigo = [99, 102, 241];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const t = y / size;
      const r = Math.round(teal[0] + (indigo[0] - teal[0]) * t);
      const g = Math.round(teal[1] + (indigo[1] - teal[1]) * t);
      const b = Math.round(teal[2] + (indigo[2] - teal[2]) * t);

      let alpha = 0;
      if (inRect(x, y, size, radius)) {
        const cx = x - size / 2;
        const cy = y - size / 2;
        const aa = Math.max(0, 1 - Math.max(Math.abs(cx) - radius, Math.abs(cy) - radius) - 0.5);
        alpha = Math.max(aa, 0.9) * 255;
      }

      let letter = false;
      if (alpha > 0) {
        const gx = Math.floor((x - originX) / cellW);
        const gy = Math.floor((y - originY) / cellH);
        if (gx >= 0 && gy >= 0 && gx < GRID_W && gy < GRID_H) {
          letter = LETTER_R[gy][gx] === 1;
        }
      }

      if (letter) {
        pixels[idx] = 255;
        pixels[idx + 1] = 255;
        pixels[idx + 2] = 255;
        pixels[idx + 3] = alpha;
      } else {
        pixels[idx] = r;
        pixels[idx + 1] = g;
        pixels[idx + 2] = b;
        pixels[idx + 3] = alpha;
      }
    }
  }
  return pixels;
}

function encodePng(size) {
  const pixels = renderIcon(size);
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(outDir, { recursive: true });
for (const size of [192, 512]) {
  const file = join(outDir, `icon-${size}.png`);
  writeFileSync(file, encodePng(size));
  console.log(`wrote ${file} (${encodePng(size).length} bytes)`);
}
