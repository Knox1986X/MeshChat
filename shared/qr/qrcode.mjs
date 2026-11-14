// Чистый генератор QR-кодов стандарта ISO/IEC 18004 без сторонних зависимостей.
// Поддерживает версионность 1..10 (Byte Mode UTF-8, коррекция ошибок Reed-Solomon Level L,
// выбор оптимальной маски из 8 вариантов) и рендеринг векторного SVG без сетевых запросов.

// Таблица параметров версий 1..10 для уровня коррекции L (1 блок данных + EC до v5, 2 или 4 блока для v6..10):
// [totalCodewords, ecCodewordsPerBlock, numBlocksGroup1, dataCwGroup1, numBlocksGroup2, dataCwGroup2, alignCenters]
const VERSION_TABLE_L = [
  null,
  [26, 7, 1, 19, 0, 0, []],
  [44, 10, 1, 34, 0, 0, [6, 18]],
  [70, 15, 1, 55, 0, 0, [6, 22]],
  [100, 20, 1, 80, 0, 0, [6, 26]],
  [134, 26, 1, 108, 0, 0, [6, 30]],
  [172, 18, 2, 68, 0, 0, [6, 34]],
  [196, 20, 2, 78, 0, 0, [6, 22, 38]],
  [242, 24, 2, 97, 0, 0, [6, 24, 42]],
  [292, 30, 2, 116, 0, 0, [6, 26, 46]],
  [346, 18, 2, 68, 2, 69, [6, 28, 50]],
];

// Предвычисленные таблицы поля Галуа GF(256) с примитивным полиномом x^8 + x^4 + x^3 + x^2 + 1 (0x11d)
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_EXP[i + 255] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function buildRsGeneratorPoly(degree) {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const root = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], root);
    }
    poly = next;
  }
  return poly;
}

function computeReedSolomonRemainder(data, ecLen) {
  const gen = buildRsGeneratorPoly(ecLen);
  const rem = new Uint8Array(ecLen);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0];
    rem.copyWithin(0, 1);
    rem[ecLen - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < ecLen; j++) {
        rem[j] ^= gfMul(gen[j + 1], factor);
      }
    }
  }
  return rem;
}

function selectVersion(byteLen) {
  for (let v = 1; v <= 10; v++) {
    const [, , nb1, dc1, nb2, dc2] = VERSION_TABLE_L[v];
    const totalDataCw = nb1 * dc1 + nb2 * dc2;
    const lenBits = v <= 9 ? 8 : 16;
    const maxBytes = Math.floor((totalDataCw * 8 - 4 - lenBits) / 8);
    if (byteLen <= maxBytes) return v;
  }
  throw new Error('Данные слишком велики для QR-кода (макс. ~271 байт в версии 10-L)');
}

function encodeDataCodewords(utf8Bytes, version) {
  const [, ecCw, nb1, dc1, nb2, dc2] = VERSION_TABLE_L[version];
  const totalDataCw = nb1 * dc1 + nb2 * dc2;
  const bits = [];
  const pushBits = (val, count) => {
    for (let i = count - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };

  // Индикатор режима Byte (0100) + счётчик символов
  pushBits(0b0100, 4);
  pushBits(utf8Bytes.length, version <= 9 ? 8 : 16);
  for (const b of utf8Bytes) pushBits(b, 8);

  // Терминатор до 4 нулевых бит
  const maxBits = totalDataCw * 8;
  const term = Math.min(4, maxBits - bits.length);
  pushBits(0, term);
  while (bits.length % 8 !== 0) bits.push(0);

  const dataCw = new Uint8Array(totalDataCw);
  for (let i = 0; i < bits.length / 8; i++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) byte = (byte << 1) | bits[i * 8 + b];
    dataCw[i] = byte;
  }
  const padBytes = [0xec, 0x11];
  for (let i = bits.length / 8, p = 0; i < totalDataCw; i++, p++) {
    dataCw[i] = padBytes[p & 1];
  }

  // Разбиение на блоки Рида — Соломона и чередование (interleaving)
  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (let i = 0; i < nb1; i++) {
    const blk = dataCw.slice(offset, offset + dc1);
    offset += dc1;
    dataBlocks.push(blk);
    ecBlocks.push(computeReedSolomonRemainder(blk, ecCw));
  }
  for (let i = 0; i < nb2; i++) {
    const blk = dataCw.slice(offset, offset + dc2);
    offset += dc2;
    dataBlocks.push(blk);
    ecBlocks.push(computeReedSolomonRemainder(blk, ecCw));
  }

  const out = [];
  const maxDc = Math.max(dc1, dc2);
  for (let col = 0; col < maxDc; col++) {
    for (const blk of dataBlocks) {
      if (col < blk.length) out.push(blk[col]);
    }
  }
  for (let col = 0; col < ecCw; col++) {
    for (const blk of ecBlocks) out.push(blk[col]);
  }
  return new Uint8Array(out);
}

function drawFinderPattern(modules, isFunc, r0, c0) {
  const size = modules.length;
  for (let dr = -1; dr <= 7; dr++) {
    for (let dc = -1; dc <= 7; dc++) {
      const r = r0 + dr;
      const c = c0 + dc;
      if (r < 0 || r >= size || c < 0 || c >= size) continue;
      const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
      const inCore = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
      const dark = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6 && (onBorder || inCore);
      modules[r][c] = dark ? 1 : 0;
      isFunc[r][c] = true;
    }
  }
}

function drawAlignmentPattern(modules, isFunc, rc, cc) {
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
      modules[rc + dr][cc + dc] = dark ? 1 : 0;
      isFunc[rc + dr][cc + dc] = true;
    }
  }
}

function drawFormatBits(modules, isFunc, maskIdx) {
  // ECC Level L = 01
  const data = (0b01 << 3) | maskIdx;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ (((rem >>> 9) & 1) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;

  const size = modules.length;
  for (let i = 0; i <= 5; i++) setFunc(i, 8, (bits >>> i) & 1);
  setFunc(7, 8, (bits >>> 6) & 1);
  setFunc(8, 8, (bits >>> 7) & 1);
  setFunc(8, 7, (bits >>> 8) & 1);
  for (let i = 9; i < 15; i++) setFunc(8, 14 - i, (bits >>> i) & 1);

  for (let i = 0; i < 8; i++) setFunc(8, size - 1 - i, (bits >>> i) & 1);
  for (let i = 8; i < 15; i++) setFunc(size - 15 + i, 8, (bits >>> i) & 1);
  setFunc(size - 8, 8, 1); // Dark module

  function setFunc(r, c, v) {
    modules[r][c] = v ? 1 : 0;
    isFunc[r][c] = true;
  }
}

function drawVersionBits(modules, isFunc, version) {
  if (version < 7) return;
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ (((rem >>> 11) & 1) * 0x1f25);
  const bits = (version << 12) | rem;
  const size = modules.length;
  for (let i = 0; i < 18; i++) {
    const bit = (bits >>> i) & 1;
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    modules[a][b] = bit;
    isFunc[a][b] = true;
    modules[b][a] = bit;
    isFunc[b][a] = true;
  }
}

function maskCondition(mask, r, c) {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return false;
  }
}

function computePenalty(modules) {
  const n = modules.length;
  let score = 0;
  // Правило 1: линии >=5 одного цвета
  for (let r = 0; r < n; r++) {
    let runColor = modules[r][0], runLen = 1;
    for (let c = 1; c < n; c++) {
      if (modules[r][c] === runColor) {
        runLen++;
        if (runLen === 5) score += 3;
        else if (runLen > 5) score += 1;
      } else {
        runColor = modules[r][c];
        runLen = 1;
      }
    }
  }
  for (let c = 0; c < n; c++) {
    let runColor = modules[0][c], runLen = 1;
    for (let r = 1; r < n; r++) {
      if (modules[r][c] === runColor) {
        runLen++;
        if (runLen === 5) score += 3;
        else if (runLen > 5) score += 1;
      } else {
        runColor = modules[r][c];
        runLen = 1;
      }
    }
  }
  // Правило 2: квадраты 2×2
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const v = modules[r][c];
      if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) {
        score += 3;
      }
    }
  }
  return score;
}

/**
 * Кодирует произвольную UTF-8 строку в квадратную булеву матрицу QR-кода.
 * @param {string} text
 * @returns {{ size: number, version: number, modules: number[][] }}
 */
export function encodeQrMatrix(text) {
  const utf8 = new TextEncoder().encode(String(text || ''));
  const version = selectVersion(utf8.length);
  const size = version * 4 + 17;

  const modules = Array.from({ length: size }, () => new Uint8Array(size));
  const isFunc = Array.from({ length: size }, () => new Array(size).fill(false));

  // Поисковые квадраты и полосы синхронизации
  drawFinderPattern(modules, isFunc, 0, 0);
  drawFinderPattern(modules, isFunc, 0, size - 7);
  drawFinderPattern(modules, isFunc, size - 7, 0);

  for (let i = 0; i < size; i++) {
    if (!isFunc[6][i]) {
      modules[6][i] = i % 2 === 0 ? 1 : 0;
      isFunc[6][i] = true;
    }
    if (!isFunc[i][6]) {
      modules[i][6] = i % 2 === 0 ? 1 : 0;
      isFunc[i][6] = true;
    }
  }

  // Выравнивающие маркеры
  const centers = VERSION_TABLE_L[version][6];
  for (let i = 0; i < centers.length; i++) {
    for (let j = 0; j < centers.length; j++) {
      if (
        (i === 0 && j === 0) ||
        (i === 0 && j === centers.length - 1) ||
        (i === centers.length - 1 && j === 0)
      ) continue;
      drawAlignmentPattern(modules, isFunc, centers[i], centers[j]);
    }
  }

  drawFormatBits(modules, isFunc, 0);
  drawVersionBits(modules, isFunc, version);

  // Зигзагообразная укладка бит данных + EC
  const codewords = encodeDataCodewords(utf8, version);
  let bitIdx = 0;
  const totalBits = codewords.length * 8;

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        const upward = ((right + 1) & 2) === 0;
        const r = upward ? size - 1 - vert : vert;
        if (!isFunc[r][c] && bitIdx < totalBits) {
          const bit = (codewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1;
          modules[r][c] = bit;
          bitIdx++;
        }
      }
    }
  }

  // Перебор 8 масок и выбор минимального штрафа
  let bestMask = 0;
  let bestPenalty = Infinity;
  let bestGrid = null;

  for (let mask = 0; mask < 8; mask++) {
    const copy = modules.map((row) => Uint8Array.from(row));
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!isFunc[r][c] && maskCondition(mask, r, c)) {
          copy[r][c] ^= 1;
        }
      }
    }
    drawFormatBits(copy, isFunc, mask);
    const p = computePenalty(copy);
    if (p < bestPenalty) {
      bestPenalty = p;
      bestMask = mask;
      bestGrid = copy;
    }
  }

  return {
    version,
    mask: bestMask,
    size,
    modules: bestGrid.map((row) => Array.from(row)),
  };
}

/**
 * Генерирует компактный SVG-путь (единый <path d="..."/>) для рендеринга чёткого QR-кода.
 */
export function buildQrSvgModel(text, margin = 3) {
  const { size, version, modules } = encodeQrMatrix(text);
  const viewBoxSize = size + margin * 2;
  const parts = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r][c]) {
        parts.push(`M${c + margin},${r + margin}h1v1h-1z`);
      }
    }
  }
  return {
    size,
    version,
    viewBox: `0 0 ${viewBoxSize} ${viewBoxSize}`,
    pathD: parts.join(''),
  };
}
