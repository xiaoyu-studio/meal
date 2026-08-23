/**
 * 一次性资源生成脚本 —— 不是运行时依赖，也不参与构建。
 *
 * 为什么需要它：iOS 不认 SVG 的 apple-touch-icon。解析不到位图时，它会拿
 * 页面截图当主屏图标 —— 而这个 app 的整个入口就是一天三次点那个图标。
 * 只用 Node 自带的 zlib 手写 PNG，仓库因此仍然是「零 npm 依赖」。
 *
 *   node tools/make-icons.mjs
 *
 * 生成物（与 icon.svg 同一套形状：橙色圆角方块、白色圆环、白色横杠）：
 *   apple-touch-icon.png  180×180  满幅不留圆角 —— iOS 自己会加圆角遮罩，
 *                                  留透明角在主屏上会显示成黑角
 *   icon-192.png          192×192  manifest 用，保留圆角与透明背景
 *   icon-512.png          512×512  同上
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// icon.svg 的坐标系与配色，改 SVG 时这里要跟着改。
const VB = 192;
const ORANGE = [212, 98, 42]; // #d4622a
const WHITE = [255, 255, 255];
const CORNER_R = 42;
const RING = { cx: 96, cy: 104, r: 44, w: 10 };
const BAR = { x0: 60, x1: 132, y: 52, w: 10 };

const SS = 4; // 每像素 4×4 超采样，边缘才不会有锯齿

function insideRoundedRect(x, y) {
  if (x < 0 || y < 0 || x > VB || y > VB) return false;
  const cx = Math.min(Math.max(x, CORNER_R), VB - CORNER_R);
  const cy = Math.min(Math.max(y, CORNER_R), VB - CORNER_R);
  return Math.hypot(x - cx, y - cy) <= CORNER_R;
}

function insideRing(x, y) {
  const d = Math.hypot(x - RING.cx, y - RING.cy);
  return Math.abs(d - RING.r) <= RING.w / 2;
}

/** 圆头横杠 = 到线段的距离 <= 半宽（stroke-linecap="round"）。 */
function insideBar(x, y) {
  const px = Math.min(Math.max(x, BAR.x0), BAR.x1);
  return Math.hypot(x - px, y - BAR.y) <= BAR.w / 2;
}

/** 返回 [r,g,b,a]，用超采样把三层覆盖率混成一个像素。 */
function samplePixel(px, py, scale, fullBleed) {
  let bg = 0;
  let fg = 0;
  for (let sy = 0; sy < SS; sy++) {
    for (let sx = 0; sx < SS; sx++) {
      const x = (px + (sx + 0.5) / SS) / scale;
      const y = (py + (sy + 0.5) / SS) / scale;
      const inShape = fullBleed ? true : insideRoundedRect(x, y);
      if (!inShape) continue;
      bg += 1;
      if (insideRing(x, y) || insideBar(x, y)) fg += 1;
    }
  }
  const total = SS * SS;
  if (bg === 0) return [0, 0, 0, 0];

  const alpha = bg / total;
  const fgRatio = fg / bg; // 白色在已着色部分里的占比
  const rgb = [0, 1, 2].map((i) =>
    Math.round(ORANGE[i] * (1 - fgRatio) + WHITE[i] * fgRatio),
  );
  return [...rgb, Math.round(alpha * 255)];
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** 最小可用的 RGBA8 PNG 编码器：IHDR + IDAT + IEND，每行 filter 0。 */
function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // no interlace

  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter type: None
    pixels.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function render(size, fullBleed) {
  const scale = size / VB;
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = samplePixel(x, y, scale, fullBleed);
      const i = (y * size + x) * 4;
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
      pixels[i + 3] = a;
    }
  }
  return encodePng(size, pixels);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const targets = [
  ['apple-touch-icon.png', 180, true],
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
];

for (const [name, size, fullBleed] of targets) {
  const png = render(size, fullBleed);
  writeFileSync(join(root, name), png);
  console.log(`${name}  ${size}×${size}  ${png.length} bytes`);
}
