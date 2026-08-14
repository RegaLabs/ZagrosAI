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

function inRoundedRect(px, py, size, radius) {
  const half = size / 2;
  const x = Math.abs(px - half);
  const y = Math.abs(py - half);
  if (x > half || y > half) return false;
  if (x <= half - radius || y <= half - radius) return true;
  const dx = x - (half - radius);
  const dy = y - (half - radius);
  return dx * dx + dy * dy <= radius * radius;
}

// Point in polygon test
function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function renderIcon(size, isMaskable = false) {
  const pixels = Buffer.alloc(size * size * 4);
  const radius = size * 0.22;

  // Normalized coordinate bounds for Zagros Mountain & Eagle Emblem
  const scale = isMaskable ? 0.70 : 0.82;
  const cx = size / 2;
  const cy = size / 2;

  function toPx(nx, ny) {
    return [(nx - 0.5) * size * scale + cx, (ny - 0.5) * size * scale + cy];
  }

  // Mountain polygon coordinates (normalized 0-1)
  // Main Left Mountain Peak (tall)
  const leftPeak = [
    toPx(0.12, 0.78),
    toPx(0.40, 0.36),
    toPx(0.68, 0.78),
  ];

  // Left Peak Snowcap
  const leftSnow = [
    toPx(0.32, 0.48),
    toPx(0.40, 0.36),
    toPx(0.48, 0.48),
    toPx(0.44, 0.52),
    toPx(0.40, 0.47),
    toPx(0.36, 0.52),
  ];

  // Right Mountain Peak (secondary)
  const rightPeak = [
    toPx(0.42, 0.78),
    toPx(0.66, 0.44),
    toPx(0.88, 0.78),
  ];

  // Right Peak Snowcap
  const rightSnow = [
    toPx(0.58, 0.54),
    toPx(0.66, 0.44),
    toPx(0.74, 0.54),
    toPx(0.70, 0.58),
    toPx(0.66, 0.53),
    toPx(0.62, 0.58),
  ];

  // Soaring Eagle Silhouette (normalized 0-1)
  const eagleWings = [
    toPx(0.50, 0.22), // Head tip
    toPx(0.54, 0.26),
    toPx(0.72, 0.23), // Right wing tip
    toPx(0.62, 0.34),
    toPx(0.50, 0.32), // Tail center
    toPx(0.38, 0.34),
    toPx(0.28, 0.23), // Left wing tip
    toPx(0.46, 0.26),
  ];

  // Brand Colors
  const bgDark = [14, 16, 19]; // #0e1013
  const bgCard = [24, 27, 33]; // #181b21
  const goldLight = [248, 200, 88]; // #f8c858
  const goldDark = [245, 158, 11]; // #f59e0b
  const mountainSlate = [42, 47, 56]; // Slate mountain base
  const mountainLight = [65, 72, 85]; // Mountain highlight

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      let alpha = 255;
      if (!isMaskable) {
        if (!inRoundedRect(x, y, size, radius)) {
          pixels[idx] = 0;
          pixels[idx + 1] = 0;
          pixels[idx + 2] = 0;
          pixels[idx + 3] = 0;
          continue;
        }
      }

      // Background gradient
      const ny = y / size;
      let r = Math.round(bgDark[0] + (bgCard[0] - bgDark[0]) * ny);
      let g = Math.round(bgDark[1] + (bgCard[1] - bgDark[1]) * ny);
      let b = Math.round(bgDark[2] + (bgCard[2] - bgDark[2]) * ny);

      // Render mountains
      if (pointInPoly(x, y, rightPeak)) {
        r = mountainSlate[0];
        g = mountainSlate[1];
        b = mountainSlate[2];
      }
      if (pointInPoly(x, y, rightSnow)) {
        const t = (y - size * 0.4) / (size * 0.2);
        r = Math.round(goldLight[0] + (goldDark[0] - goldLight[0]) * Math.max(0, Math.min(1, t)));
        g = Math.round(goldLight[1] + (goldDark[1] - goldLight[1]) * Math.max(0, Math.min(1, t)));
        b = Math.round(goldLight[2] + (goldDark[2] - goldLight[2]) * Math.max(0, Math.min(1, t)));
      }

      if (pointInPoly(x, y, leftPeak)) {
        // Left side lighter, right side shadow
        const leftApex = toPx(0.40, 0.36);
        const isLeftSlope = x <= leftApex[0];
        const baseColor = isLeftSlope ? mountainLight : mountainSlate;
        r = baseColor[0];
        g = baseColor[1];
        b = baseColor[2];
      }
      if (pointInPoly(x, y, leftSnow)) {
        const t = (y - size * 0.3) / (size * 0.25);
        r = Math.round(goldLight[0] + (goldDark[0] - goldLight[0]) * Math.max(0, Math.min(1, t)));
        g = Math.round(goldLight[1] + (goldDark[1] - goldLight[1]) * Math.max(0, Math.min(1, t)));
        b = Math.round(goldLight[2] + (goldDark[2] - goldLight[2]) * Math.max(0, Math.min(1, t)));
      }

      // Render soaring eagle
      if (pointInPoly(x, y, eagleWings)) {
        const t = (y - size * 0.2) / (size * 0.15);
        r = Math.round(goldLight[0] + (goldDark[0] - goldLight[0]) * Math.max(0, Math.min(1, t)));
        g = Math.round(goldLight[1] + (goldDark[1] - goldLight[1]) * Math.max(0, Math.min(1, t)));
        b = Math.round(goldLight[2] + (goldDark[2] - goldLight[2]) * Math.max(0, Math.min(1, t)));
      }

      pixels[idx] = r;
      pixels[idx + 1] = g;
      pixels[idx + 2] = b;
      pixels[idx + 3] = alpha;
    }
  }
  return pixels;
}

function encodePng(size, isMaskable = false) {
  const pixels = renderIcon(size, isMaskable);
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
  writeFileSync(file, encodePng(size, false));
  console.log(`wrote ${file} (${encodePng(size, false).length} bytes)`);
}

const maskableFile = join(outDir, `icon-maskable-512.png`);
writeFileSync(maskableFile, encodePng(512, true));
console.log(`wrote ${maskableFile} (${encodePng(512, true).length} bytes)`);
