const SAND_UNIT_VALUE = 1;
const BUCKET_CAPACITY = 300;
const SLOT_COUNT = 5;
const SOURCE_IMAGE_SIZE = 128;
const BELT_SPEED_MULTIPLIERS = [1, 2, 3];
const GRAVITY_DIRECTIONS = ["down", "right", "up", "left"];
const GRAVITY_VECTORS = {
  down: { x: 0, y: 1, label: "下" },
  right: { x: 1, y: 0, label: "右" },
  up: { x: 0, y: -1, label: "上" },
  left: { x: -1, y: 0, label: "左" },
};
const SUCK_TWEEN_MS = 68;
const SUCK_TRAIL_MS = 120;
const SUCK_TRAIL_COUNT = 7;
const ABSORB_ROUND_DELAY_MS = 6;
const BUCKET_REMOVE_DELAY_MS = 36;
const BELT_SPEED_PX_PER_SECOND = 54;
const BUCKET_SUCTION_HALF_WIDTH = 22;
const STREAM_SUCK_INTERVAL_MS = 8;
const IDLE_SCAN_INTERVAL_MS = 48;
const SLOT_UI_REFRESH_MS = 140;
const SAND_STEP_MS = 16;
const SAND_STEPS_PER_FRAME = 4;
const ACTIVE_CELL_BUDGET = 4200;
const WAKE_COLUMN_RADIUS = 9;
const WAKE_ABOVE_ROWS = 72;
const WAKE_BELOW_ROWS = 4;
const EMPTY_COLOR_ID = 0;
const SAND_TEXTURE_KEY = "sand-bitmap";

const DEFAULT_COLOR_DATA = {
  red: { label: "紅", hex: "#df5148", value: 0xdf5148 },
  green: { label: "綠", hex: "#37a66b", value: 0x37a66b },
  blue: { label: "藍", hex: "#3f79c8", value: 0x3f79c8 },
  yellow: { label: "黃", hex: "#d9a928", value: 0xd9a928 },
  purple: { label: "紫", hex: "#8958bf", value: 0x8958bf },
  sky: { label: "天", hex: "#78c8e6", value: 0x78c8e6 },
  skin: { label: "膚", hex: "#d9905d", value: 0xd9905d },
  brown: { label: "棕", hex: "#7b4a32", value: 0x7b4a32 },
  dark: { label: "黑", hex: "#2c2528", value: 0x2c2528 },
  white: { label: "白", hex: "#f4ead8", value: 0xf4ead8 },
};

let COLOR_DATA = {};
let COLOR_ORDER = [];
let BUCKET_COLORS = [];
let COLOR_ID_BY_KEY = new Map();
let COLOR_KEY_BY_ID = ["empty"];
let RGBA_BY_COLOR_ID = [[0, 0, 0, 0]];

function rebuildPaletteLookups() {
  COLOR_ID_BY_KEY = new Map(COLOR_ORDER.map((color, index) => [color, index + 1]));
  COLOR_KEY_BY_ID = ["empty", ...COLOR_ORDER];

  const rgba = [[0, 0, 0, 0]];
  COLOR_ORDER.forEach((color) => {
    const hex = COLOR_DATA[color].hex.replace("#", "");
    rgba.push([
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
      255,
    ]);
  });
  RGBA_BY_COLOR_ID = rgba;
}

function setGamePalette(paletteEntries) {
  COLOR_DATA = {};
  COLOR_ORDER = [];
  BUCKET_COLORS = [];

  paletteEntries.forEach((entry) => {
    COLOR_DATA[entry.key] = {
      label: entry.label,
      hex: entry.hex,
      value: Number.parseInt(entry.hex.replace("#", ""), 16),
    };
    COLOR_ORDER.push(entry.key);
    BUCKET_COLORS.push(entry.key);
  });

  rebuildPaletteLookups();
}

setGamePalette(["sky", "brown", "skin", "dark", "white", "red"].map((key) => ({ key, ...DEFAULT_COLOR_DATA[key] })));

const elements = {
  imageUploadInput: document.querySelector("#imageUploadInput"),
  paletteSizeSelect: document.querySelector("#paletteSizeSelect"),
  uploadStatus: document.querySelector("#uploadStatus"),
  gravityButton: document.querySelector("#gravityButton"),
  beltSpeedButton: document.querySelector("#beltSpeedButton"),
  resetButton: document.querySelector("#resetButton"),
  completionOverlay: document.querySelector("#completionOverlay"),
  phasePill: document.querySelector("#phasePill"),
  remainingValue: document.querySelector("#remainingValue"),
  remainingByColor: document.querySelector("#remainingByColor"),
  turnValue: document.querySelector("#turnValue"),
  availableColors: document.querySelector("#availableColors"),
  bucketPalette: document.querySelector("#bucketPalette"),
  messageBar: document.querySelector("#messageBar"),
  eventLog: document.querySelector("#eventLog"),
};

let gameState = null;
let sceneRef = null;
let phaserGame = null;
let isAbsorptionLoopRunning = false;
let lastSlotUiRefreshAt = 0;
let logItems = [];
let bucketButtons = new Map();
let beltSpeedIndex = 0;
let bucketPaletteSignature = "";

function createFilledPainting(size, color) {
  return Array.from({ length: size }, () => Array(size).fill(color));
}

function clampInteger(value, min, max) {
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function drawRect(rows, left, top, right, bottom, color) {
  const minY = clampInteger(top, 0, rows.length - 1);
  const maxY = clampInteger(bottom, 0, rows.length - 1);
  const minX = clampInteger(left, 0, rows[0].length - 1);
  const maxX = clampInteger(right, 0, rows[0].length - 1);

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      rows[y][x] = color;
    }
  }
}

function drawEllipse(rows, centerX, centerY, radiusX, radiusY, color) {
  const minY = Math.max(0, Math.floor(centerY - radiusY));
  const maxY = Math.min(rows.length - 1, Math.ceil(centerY + radiusY));
  const minX = Math.max(0, Math.floor(centerX - radiusX));
  const maxX = Math.min(rows[0].length - 1, Math.ceil(centerX + radiusX));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const normalizedX = (x - centerX) / radiusX;
      const normalizedY = (y - centerY) / radiusY;
      if (normalizedX * normalizedX + normalizedY * normalizedY <= 1) {
        rows[y][x] = color;
      }
    }
  }
}

function createSourcePainting() {
  const rows = createFilledPainting(SOURCE_IMAGE_SIZE, "sky");

  // 這張來源圖是真正 128x128；每一格都會直接變成一顆可吸收的沙。
  drawEllipse(rows, 64, 60, 40, 48, "brown");
  drawEllipse(rows, 64, 62, 30, 37, "skin");
  drawEllipse(rows, 30, 63, 8, 14, "skin");
  drawEllipse(rows, 98, 63, 8, 14, "skin");

  drawEllipse(rows, 64, 25, 33, 16, "red");
  drawRect(rows, 23, 30, 105, 39, "red");
  drawRect(rows, 36, 39, 92, 46, "brown");

  drawRect(rows, 39, 52, 89, 67, "dark");
  drawRect(rows, 47, 56, 60, 61, "white");
  drawRect(rows, 73, 56, 84, 61, "white");
  drawRect(rows, 61, 60, 67, 67, "skin");

  drawRect(rows, 52, 80, 76, 89, "dark");
  drawRect(rows, 56, 81, 72, 85, "red");
  drawRect(rows, 58, 86, 70, 89, "white");

  drawEllipse(rows, 64, 91, 24, 16, "brown");
  drawRect(rows, 55, 92, 73, 108, "skin");
  drawRect(rows, 36, 108, 92, 127, "white");
  drawRect(rows, 43, 102, 85, 116, "red");
  drawRect(rows, 51, 116, 77, 127, "dark");

  return rows;
}

let currentLevelRows = createSourcePainting();

function beltSpeedMultiplier() {
  return BELT_SPEED_MULTIPLIERS[beltSpeedIndex] ?? 1;
}

function currentBeltSpeed() {
  return BELT_SPEED_PX_PER_SECOND * beltSpeedMultiplier();
}

function gravityLabel(direction) {
  return GRAVITY_VECTORS[direction]?.label ?? GRAVITY_VECTORS.down.label;
}

function clampPaletteSize(value) {
  return clampInteger(Number.parseInt(value, 10) || 6, 6, 8);
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((value) => clampInteger(value, 0, 255).toString(16).padStart(2, "0")).join("")}`;
}

function colorDistanceSquared(a, b) {
  const red = a.r - b.r;
  const green = a.g - b.g;
  const blue = a.b - b.b;
  return red * red + green * green + blue * blue;
}

function nearestColorIndex(pixel, centers) {
  let bestIndex = 0;
  let bestDistance = Infinity;
  centers.forEach((center, index) => {
    const distance = colorDistanceSquared(pixel, center);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function pixelLuminance(pixel) {
  return pixel.r * 0.2126 + pixel.g * 0.7152 + pixel.b * 0.0722;
}

function extractPixelsFromImageData(imageData) {
  const pixels = [];
  const fallback = { r: 245, g: 247, b: 242 };
  for (let offset = 0; offset < imageData.data.length; offset += 4) {
    const alpha = imageData.data[offset + 3];
    if (alpha < 24) {
      pixels.push(fallback);
      continue;
    }

    pixels.push({
      r: imageData.data[offset],
      g: imageData.data[offset + 1],
      b: imageData.data[offset + 2],
    });
  }
  return pixels;
}

function quantizePixels(pixels, requestedColorCount) {
  const colorCount = clampPaletteSize(requestedColorCount);
  const sortedPixels = [...pixels].sort((a, b) => pixelLuminance(a) - pixelLuminance(b));
  let centers = Array.from({ length: colorCount }, (_, index) => {
    const sampleIndex = Math.min(sortedPixels.length - 1, Math.floor(((index + 0.5) * sortedPixels.length) / colorCount));
    return { ...sortedPixels[sampleIndex] };
  });

  for (let iteration = 0; iteration < 12; iteration += 1) {
    const sums = centers.map(() => ({ r: 0, g: 0, b: 0, count: 0 }));
    pixels.forEach((pixel) => {
      const centerIndex = nearestColorIndex(pixel, centers);
      sums[centerIndex].r += pixel.r;
      sums[centerIndex].g += pixel.g;
      sums[centerIndex].b += pixel.b;
      sums[centerIndex].count += 1;
    });

    const usedFallbackPixelIndices = new Set();
    const nextCenters = [];
    centers.forEach((center, index) => {
      const sum = sums[index];
      if (sum.count === 0) {
        // 空色群會產生沒有沙子的水桶；改用距離既有中心最遠的像素補位，讓色盤維持可玩。
        nextCenters.push(pickFarthestPixelCenter(pixels, [...centers, ...nextCenters], usedFallbackPixelIndices));
        return;
      }
      nextCenters.push({
        r: Math.round(sum.r / sum.count),
        g: Math.round(sum.g / sum.count),
        b: Math.round(sum.b / sum.count),
      });
    });
    centers = nextCenters;
  }

  const repairPixelIndices = new Set();
  for (let repairIndex = 0; repairIndex < colorCount; repairIndex += 1) {
    const counts = countCenterAssignments(pixels, centers);
    const emptyCenterIndex = counts.findIndex((count) => count === 0);
    if (emptyCenterIndex === -1) {
      break;
    }
    centers[emptyCenterIndex] = pickFarthestPixelCenter(pixels, centers, repairPixelIndices);
  }

  const finalCounts = countCenterAssignments(pixels, centers);

  return centers
    .map((center, index) => ({ ...center, count: finalCounts[index] }))
    .sort((a, b) => b.count - a.count);
}

function countCenterAssignments(pixels, centers) {
  const counts = centers.map(() => 0);
  pixels.forEach((pixel) => {
    counts[nearestColorIndex(pixel, centers)] += 1;
  });
  return counts;
}

function pickFarthestPixelCenter(pixels, centers, usedPixelIndices) {
  let bestIndex = 0;
  let bestDistance = -1;
  pixels.forEach((pixel, index) => {
    if (usedPixelIndices.has(index)) {
      return;
    }

    const nearestDistance = centers.reduce((distance, center) => Math.min(distance, colorDistanceSquared(pixel, center)), Infinity);
    if (nearestDistance > bestDistance) {
      bestDistance = nearestDistance;
      bestIndex = index;
    }
  });

  usedPixelIndices.add(bestIndex);
  return { ...pixels[bestIndex] };
}

function buildRowsFromPixels(pixels, centers, paletteEntries) {
  const rows = [];
  for (let y = 0; y < SOURCE_IMAGE_SIZE; y += 1) {
    const row = [];
    for (let x = 0; x < SOURCE_IMAGE_SIZE; x += 1) {
      const pixel = pixels[y * SOURCE_IMAGE_SIZE + x];
      row.push(paletteEntries[nearestColorIndex(pixel, centers)].key);
    }
    rows.push(row);
  }
  return rows;
}

async function decodeImageFile(file) {
  if (window.createImageBitmap) {
    return createImageBitmap(file);
  }

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("圖片讀取失敗。"));
    image.src = URL.createObjectURL(file);
  });
}

function drawImageToSourceCanvas(image) {
  const canvas = document.createElement("canvas");
  canvas.width = SOURCE_IMAGE_SIZE;
  canvas.height = SOURCE_IMAGE_SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  const scale = Math.max(SOURCE_IMAGE_SIZE / image.width, SOURCE_IMAGE_SIZE / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const drawX = (SOURCE_IMAGE_SIZE - drawWidth) / 2;
  const drawY = (SOURCE_IMAGE_SIZE - drawHeight) / 2;
  context.clearRect(0, 0, SOURCE_IMAGE_SIZE, SOURCE_IMAGE_SIZE);
  context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
  return context.getImageData(0, 0, SOURCE_IMAGE_SIZE, SOURCE_IMAGE_SIZE);
}

async function convertImageFileToLevel(file, paletteSize) {
  const image = await decodeImageFile(file);
  const imageData = drawImageToSourceCanvas(image);
  image.close?.();

  const pixels = extractPixelsFromImageData(imageData);
  const centers = quantizePixels(pixels, paletteSize);
  const paletteEntries = centers.map((center, index) => ({
    key: `upload_${index + 1}`,
    label: `色${index + 1}`,
    hex: rgbToHex(center.r, center.g, center.b),
  }));
  const rows = buildRowsFromPixels(pixels, centers, paletteEntries);
  return { rows, paletteEntries };
}

function colorId(color) {
  return COLOR_ID_BY_KEY.get(color) ?? EMPTY_COLOR_ID;
}

function colorFromId(id) {
  return COLOR_KEY_BY_ID[id] ?? null;
}

class SandEngine {
  constructor(rows) {
    this.height = rows.length;
    this.width = rows[0]?.length ?? 0;
    this.colorGrid = new Uint8Array(this.width * this.height);
    this.colorCounts = new Uint32Array(COLOR_ORDER.length + 1);
    this.remainingTotal = 0;
    this.activeCells = new Set();
    this.dirtyCells = new Set();
    this.sandAccumulator = 0;
    this.gravityDirection = "down";

    rows.forEach((row, rowIndex) => {
      if (row.length !== this.width) {
        throw new Error(`第 ${rowIndex + 1} 列寬度不一致。`);
      }

      row.forEach((color, columnIndex) => {
        const id = colorId(color);
        this.colorGrid[this.index(columnIndex, rowIndex)] = id;
        if (id !== EMPTY_COLOR_ID) {
          this.incrementColorCount(id);
          this.remainingTotal += SAND_UNIT_VALUE;
        }
      });
    });

    this.markAllDirty();
  }

  index(cellX, cellY) {
    return cellY * this.width + cellX;
  }

  cellX(index) {
    return index % this.width;
  }

  cellY(index) {
    return Math.floor(index / this.width);
  }

  isInsideCell(cellX, cellY) {
    return cellX >= 0 && cellX < this.width && cellY >= 0 && cellY < this.height;
  }

  isInsideIndex(index) {
    return index >= 0 && index < this.colorGrid.length;
  }

  getCell(cellX, cellY) {
    if (!this.isInsideCell(cellX, cellY)) {
      return EMPTY_COLOR_ID;
    }
    return this.colorGrid[this.index(cellX, cellY)];
  }

  getIndex(index) {
    if (!this.isInsideIndex(index)) {
      return EMPTY_COLOR_ID;
    }
    return this.colorGrid[index];
  }

  isCellEmpty(cellX, cellY) {
    return this.isInsideCell(cellX, cellY) && this.getCell(cellX, cellY) === EMPTY_COLOR_ID;
  }

  incrementColorCount(id) {
    if (id !== EMPTY_COLOR_ID) {
      this.colorCounts[id] += SAND_UNIT_VALUE;
    }
  }

  decrementColorCount(id) {
    if (id !== EMPTY_COLOR_ID) {
      this.colorCounts[id] = Math.max(0, this.colorCounts[id] - SAND_UNIT_VALUE);
    }
  }

  hasColor(color) {
    return this.hasColorId(colorId(color));
  }

  hasColorId(id) {
    return id !== EMPTY_COLOR_ID && this.colorCounts[id] > 0;
  }

  markDirty(index) {
    if (this.isInsideIndex(index)) {
      this.dirtyCells.add(index);
    }
  }

  markAllDirty() {
    for (let index = 0; index < this.colorGrid.length; index += 1) {
      this.dirtyCells.add(index);
    }
  }

  hasDirtyCells() {
    return this.dirtyCells.size > 0;
  }

  consumeDirtyCells() {
    const cells = [...this.dirtyCells];
    this.dirtyCells.clear();
    return cells;
  }

  resetDynamics() {
    this.activeCells.clear();
    this.dirtyCells.clear();
    this.sandAccumulator = 0;
  }

  gravityVector(direction = this.gravityDirection) {
    return GRAVITY_VECTORS[direction] ?? GRAVITY_VECTORS.down;
  }

  sideVector() {
    const gravity = this.gravityVector();
    return { x: gravity.y, y: -gravity.x };
  }

  sideAxis() {
    const side = this.sideVector();
    return side.x !== 0 ? "x" : "y";
  }

  lineLimit() {
    return this.sideAxis() === "x" ? this.width - 1 : this.height - 1;
  }

  gravityDepth(index) {
    const gravity = this.gravityVector();
    return this.cellX(index) * gravity.x + this.cellY(index) * gravity.y;
  }

  lineCoordinateForCell(cellX, cellY) {
    return this.sideAxis() === "x" ? cellX : cellY;
  }

  cellAtDirectionalOffset(cellX, cellY, sideOffset, gravityOffset) {
    const side = this.sideVector();
    const gravity = this.gravityVector();
    return {
      x: cellX + side.x * sideOffset + gravity.x * gravityOffset,
      y: cellY + side.y * sideOffset + gravity.y * gravityOffset,
    };
  }

  clearIndex(index) {
    if (!this.isInsideIndex(index) || this.colorGrid[index] === EMPTY_COLOR_ID) {
      return false;
    }

    const removedColorId = this.colorGrid[index];
    this.colorGrid[index] = EMPTY_COLOR_ID;
    this.decrementColorCount(removedColorId);
    this.remainingTotal = Math.max(0, this.remainingTotal - SAND_UNIT_VALUE);
    this.markDirty(index);
    return true;
  }

  moveIndex(fromIndex, toIndex) {
    if (!this.isInsideIndex(fromIndex) || !this.isInsideIndex(toIndex)) {
      return false;
    }

    const color = this.colorGrid[fromIndex];
    if (color === EMPTY_COLOR_ID || this.colorGrid[toIndex] !== EMPTY_COLOR_ID) {
      return false;
    }

    this.colorGrid[toIndex] = color;
    this.colorGrid[fromIndex] = EMPTY_COLOR_ID;
    this.markDirty(fromIndex);
    this.markDirty(toIndex);
    return true;
  }

  activateCell(cellX, cellY) {
    if (!this.isInsideCell(cellX, cellY)) {
      return;
    }
    this.activeCells.add(this.index(cellX, cellY));
  }

  activateCellNeighborhood(cellX, cellY) {
    // 使用重力座標系喚醒鄰近沙粒，讓旋轉重力後仍能沿新方向補位。
    for (let gravityOffset = -2; gravityOffset <= 1; gravityOffset += 1) {
      for (let sideOffset = -1; sideOffset <= 1; sideOffset += 1) {
        const cell = this.cellAtDirectionalOffset(cellX, cellY, sideOffset, gravityOffset);
        this.activateCell(cell.x, cell.y);
      }
    }
  }

  wakeLocalSand(cellX, cellY) {
    for (let gravityOffset = -WAKE_ABOVE_ROWS; gravityOffset <= WAKE_BELOW_ROWS; gravityOffset += 1) {
      for (let sideOffset = -WAKE_COLUMN_RADIUS; sideOffset <= WAKE_COLUMN_RADIUS; sideOffset += 1) {
        const cell = this.cellAtDirectionalOffset(cellX, cellY, sideOffset, gravityOffset);
        this.activateCell(cell.x, cell.y);
      }
    }
  }

  wakeArea(left, top, right, bottom) {
    const minX = clampInteger(Math.min(left, right), 0, this.width - 1);
    const maxX = clampInteger(Math.max(left, right), 0, this.width - 1);
    const minY = clampInteger(Math.min(top, bottom), 0, this.height - 1);
    const maxY = clampInteger(Math.max(top, bottom), 0, this.height - 1);

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        this.activateCell(x, y);
      }
    }
  }

  getOuterSandIndexOnLine(lineCoordinate) {
    const line = clampInteger(lineCoordinate, 0, this.lineLimit());
    const gravity = this.gravityVector();

    if (this.sideAxis() === "x") {
      if (gravity.y > 0) {
        for (let y = this.height - 1; y >= 0; y -= 1) {
          const index = this.index(line, y);
          if (this.getIndex(index) !== EMPTY_COLOR_ID) {
            return index;
          }
        }
      } else {
        for (let y = 0; y < this.height; y += 1) {
          const index = this.index(line, y);
          if (this.getIndex(index) !== EMPTY_COLOR_ID) {
            return index;
          }
        }
      }
      return null;
    }

    if (gravity.x > 0) {
      for (let x = this.width - 1; x >= 0; x -= 1) {
        const index = this.index(x, line);
        if (this.getIndex(index) !== EMPTY_COLOR_ID) {
          return index;
        }
      }
    } else {
      for (let x = 0; x < this.width; x += 1) {
        const index = this.index(x, line);
        if (this.getIndex(index) !== EMPTY_COLOR_ID) {
          return index;
        }
      }
    }
    return null;
  }

  availableColorsInLineRange(minLine, maxLine) {
    const colors = new Set();
    const min = clampInteger(Math.min(minLine, maxLine), 0, this.lineLimit());
    const max = clampInteger(Math.max(minLine, maxLine), 0, this.lineLimit());

    for (let line = min; line <= max; line += 1) {
      const index = this.getOuterSandIndexOnLine(line);
      if (index === null) {
        continue;
      }

      const color = colorFromId(this.getIndex(index));
      if (color !== null) {
        colors.add(color);
      }
    }

    return colors;
  }

  findAbsorbableCellInLineRange(targetColorId, minLine, maxLine, reservedCellIndices = new Set(), preferredLine = null) {
    const min = clampInteger(Math.min(minLine, maxLine), 0, this.lineLimit());
    const max = clampInteger(Math.max(minLine, maxLine), 0, this.lineLimit());
    const centerLine = preferredLine ?? (min + max) / 2;
    let bestCell = null;
    let bestDepth = -Infinity;
    let bestDistance = Infinity;

    for (let line = min; line <= max; line += 1) {
      const index = this.getOuterSandIndexOnLine(line);
      if (index === null || reservedCellIndices.has(index) || this.getIndex(index) !== targetColorId) {
        continue;
      }

      const cellX = this.cellX(index);
      const cellY = this.cellY(index);
      const depth = this.gravityDepth(index);
      const distance = Math.abs(line - centerLine);
      if (depth > bestDepth || (depth === bestDepth && distance < bestDistance)) {
        bestCell = {
          index,
          id: index,
          cellX,
          cellY,
          colorId: targetColorId,
        };
        bestDepth = depth;
        bestDistance = distance;
      }
    }

    return bestCell;
  }

  tryMoveCell(index) {
    const color = this.getIndex(index);
    if (color === EMPTY_COLOR_ID) {
      return false;
    }

    const cellX = this.cellX(index);
    const cellY = this.cellY(index);
    const diagonalOrder = Math.random() < 0.5 ? [-1, 1] : [1, -1];
    const candidates = [
      this.cellAtDirectionalOffset(cellX, cellY, 0, 1),
      ...diagonalOrder.map((sideOffset) => this.cellAtDirectionalOffset(cellX, cellY, sideOffset, 1)),
    ];

    for (const candidate of candidates) {
      if (!this.isCellEmpty(candidate.x, candidate.y)) {
        continue;
      }

      const targetIndex = this.index(candidate.x, candidate.y);
      if (!this.moveIndex(index, targetIndex)) {
        continue;
      }

      this.activateCellNeighborhood(cellX, cellY);
      this.activateCellNeighborhood(candidate.x, candidate.y);
      return true;
    }

    return false;
  }

  stepActiveSand() {
    if (this.activeCells.size === 0) {
      return false;
    }

    const activeCells = [...this.activeCells].sort((a, b) => {
      const depthDelta = this.gravityDepth(b) - this.gravityDepth(a);
      return depthDelta !== 0 ? depthDelta : Math.random() - 0.5;
    });
    this.activeCells.clear();

    let movedAny = false;
    let processed = 0;
    for (const index of activeCells) {
      if (processed >= ACTIVE_CELL_BUDGET) {
        this.activeCells.add(index);
        continue;
      }

      processed += 1;
      movedAny = this.tryMoveCell(index) || movedAny;
    }

    return movedAny;
  }

  update(delta) {
    this.sandAccumulator += delta;
    let stepped = false;
    let stepCount = 0;
    while (this.sandAccumulator >= SAND_STEP_MS && stepCount < SAND_STEPS_PER_FRAME) {
      this.sandAccumulator -= SAND_STEP_MS;
      stepped = this.stepActiveSand() || stepped;
      stepCount += 1;
    }
    return stepped;
  }

  eraseCircle(centerX, centerY, radius) {
    const minX = clampInteger(centerX - radius, 0, this.width - 1);
    const maxX = clampInteger(centerX + radius, 0, this.width - 1);
    const minY = clampInteger(centerY - radius, 0, this.height - 1);
    const maxY = clampInteger(centerY + radius, 0, this.height - 1);
    const radiusSquared = radius * radius;

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dx = x - centerX;
        const dy = y - centerY;
        if (dx * dx + dy * dy <= radiusSquared) {
          this.clearIndex(this.index(x, y));
        }
      }
    }

    this.wakeArea(minX - 1, minY - 1, maxX + 1, maxY + 1);
  }

  recolorArea(centerX, centerY, radius, color) {
    const targetColorId = colorId(color);
    if (targetColorId === EMPTY_COLOR_ID) {
      return;
    }

    const minX = clampInteger(centerX - radius, 0, this.width - 1);
    const maxX = clampInteger(centerX + radius, 0, this.width - 1);
    const minY = clampInteger(centerY - radius, 0, this.height - 1);
    const maxY = clampInteger(centerY + radius, 0, this.height - 1);
    const radiusSquared = radius * radius;

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const index = this.index(x, y);
        const dx = x - centerX;
        const dy = y - centerY;
        const originalColorId = this.getIndex(index);
        if (dx * dx + dy * dy <= radiusSquared && originalColorId !== EMPTY_COLOR_ID) {
          if (originalColorId !== targetColorId) {
            this.decrementColorCount(originalColorId);
            this.incrementColorCount(targetColorId);
          }
          this.colorGrid[index] = targetColorId;
          this.markDirty(index);
        }
      }
    }

    this.wakeArea(minX - 1, minY - 1, maxX + 1, maxY + 1);
  }

  spawnSandRect(left, top, right, bottom, color) {
    const targetColorId = colorId(color);
    if (targetColorId === EMPTY_COLOR_ID) {
      return;
    }

    const minX = clampInteger(Math.min(left, right), 0, this.width - 1);
    const maxX = clampInteger(Math.max(left, right), 0, this.width - 1);
    const minY = clampInteger(Math.min(top, bottom), 0, this.height - 1);
    const maxY = clampInteger(Math.max(top, bottom), 0, this.height - 1);

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const index = this.index(x, y);
        const originalColorId = this.getIndex(index);
        if (originalColorId === EMPTY_COLOR_ID) {
          this.remainingTotal += SAND_UNIT_VALUE;
          this.incrementColorCount(targetColorId);
        } else if (originalColorId !== targetColorId) {
          this.decrementColorCount(originalColorId);
          this.incrementColorCount(targetColorId);
        }
        this.colorGrid[index] = targetColorId;
        this.markDirty(index);
        this.activateCell(x, y);
      }
    }

    this.wakeArea(minX - 1, minY - 1, maxX + 1, maxY + 1);
  }

  rotateGravity(direction) {
    if (!GRAVITY_DIRECTIONS.includes(direction) || direction === this.gravityDirection) {
      return false;
    }

    this.gravityDirection = direction;
    this.wakeArea(0, 0, this.width - 1, this.height - 1);
    return true;
  }

  isCleared() {
    return this.remainingTotal <= 0;
  }
}

class Bucket {
  constructor(color) {
    this.color = color;
    this.capacity = BUCKET_CAPACITY;
    this.amount = 0;
  }

  absorb() {
    this.amount = Math.min(this.capacity, this.amount + SAND_UNIT_VALUE);
  }

  isFull() {
    return this.amount >= this.capacity;
  }
}

class Conveyor {
  constructor(slotCount) {
    this.slots = Array.from({ length: slotCount }, () => null);
  }

  placeBucket(color, preferredSlotIndex = null) {
    const slotIndex =
      preferredSlotIndex !== null && this.slots[preferredSlotIndex] === null
        ? preferredSlotIndex
        : this.slots.findIndex((bucket) => bucket === null);
    if (slotIndex === -1) {
      throw new Error("輸送帶已滿。");
    }
    this.slots[slotIndex] = new Bucket(color);
    return slotIndex;
  }

  activeBuckets() {
    return this.slots.filter((bucket) => bucket !== null);
  }

  removeFullBuckets() {
    const removed = [];
    this.slots = this.slots.map((bucket) => {
      if (bucket?.isFull()) {
        removed.push(bucket);
        return null;
      }
      return bucket;
    });
    return removed;
  }

  removeBucketsWithoutRemainingSand(field) {
    const removed = [];
    this.slots = this.slots.map((bucket) => {
      if (bucket !== null && !field.hasColor(bucket.color)) {
        removed.push(bucket);
        return null;
      }
      return bucket;
    });
    return removed;
  }

  isFull() {
    return this.slots.every((bucket) => bucket !== null);
  }

  bucketColors() {
    return this.activeBuckets().map((bucket) => bucket.color);
  }

  findBucketSlot(targetBucket) {
    return this.slots.findIndex((bucket) => bucket === targetBucket);
  }
}

class GameState {
  constructor(rows) {
    this.field = new SandEngine(rows);
    this.conveyor = new Conveyor(SLOT_COUNT);
    this.phase = "running";
    this.turn = 0;
  }

  placeBucket(color, preferredSlotIndex = null) {
    if (this.phase !== "running") {
      return null;
    }
    const slotIndex = this.conveyor.placeBucket(color, preferredSlotIndex);
    this.turn += 1;
    return slotIndex;
  }

  updatePhase(availableColors) {
    if (this.field.isCleared()) {
      this.phase = "won";
      return;
    }

    if (this.isDeadlocked(availableColors)) {
      this.phase = "lost";
    }
  }

  isDeadlocked(availableColors) {
    if (!this.conveyor.isFull()) {
      return false;
    }

    const availableColorSet = new Set(availableColors);
    return this.conveyor.bucketColors().every((color) => !availableColorSet.has(color));
  }
}

function colorLabel(color) {
  return COLOR_DATA[color]?.label ?? color;
}

function colorHex(color) {
  return COLOR_DATA[color]?.hex ?? "#8f9893";
}

function colorValue(color) {
  return COLOR_DATA[color]?.value ?? 0x8f9893;
}

function sortColors(colors) {
  return [...colors].sort((a, b) => COLOR_ORDER.indexOf(a) - COLOR_ORDER.indexOf(b));
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function tweenTo(scene, target, config) {
  const originalOnComplete = config.onComplete;
  return new Promise((resolve) => {
    scene.tweens.add({
      targets: target,
      ...config,
      onComplete: (...args) => {
        originalOnComplete?.(...args);
        resolve();
      },
    });
  });
}

function setMessage(text) {
  elements.messageBar.textContent = text;
}

function setUploadStatus(text) {
  if (elements.uploadStatus) {
    elements.uploadStatus.textContent = text;
  }
}

function addLog(text, color = "green") {
  if (!elements.eventLog || elements.eventLog.closest(".is-hidden")) {
    return;
  }

  logItems.unshift({ text, color });
  logItems = logItems.slice(0, 8);
  renderLog();
}

function renderLog() {
  elements.eventLog.replaceChildren();
  logItems.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item.text;
    li.style.setProperty("--event-color", colorHex(item.color));
    elements.eventLog.append(li);
  });
}

function applyConvertedLevel(rows, paletteEntries) {
  setGamePalette(paletteEntries);
  currentLevelRows = rows;
  bucketButtons = new Map();
  bucketPaletteSignature = "";
  gameState = new GameState(currentLevelRows);
  isAbsorptionLoopRunning = false;
  lastSlotUiRefreshAt = 0;
  logItems = [];
  renderLog();
  sceneRef?.createSandBitmapLayer();
  sceneRef?.syncFromState(gameState);
  renderUI();
}

async function handleImageUpload(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  const paletteSize = clampPaletteSize(elements.paletteSizeSelect?.value ?? 6);
  setUploadStatus("轉換中...");

  try {
    const { rows, paletteEntries } = await convertImageFileToLevel(file, paletteSize);
    applyConvertedLevel(rows, paletteEntries);
    setMessage(`圖片已轉成 ${SOURCE_IMAGE_SIZE}x${SOURCE_IMAGE_SIZE}、${paletteEntries.length} 色沙畫。`);
    setUploadStatus(`${paletteEntries.length} 色完成`);
  } catch (error) {
    setUploadStatus("轉換失敗");
    setMessage(error.message || "圖片轉換失敗。");
  } finally {
    event.target.value = "";
  }
}

if (!window.Phaser) {
  setMessage("Phaser 載入失敗。請確認瀏覽器可以連線到 CDN，或改用本機版 Phaser。");
  throw new Error("Phaser is required for Sand Pixel Sorter.");
}

class SandSorterScene extends Phaser.Scene {
  constructor() {
    super("SandSorterScene");
    this.slotObjects = [];
    this.frameObjects = [];
    this.beltMaskObjects = [];
    this.beltOffset = 0;
    this.slotWidth = 92;
    this.slotGap = 14;
    this.lastSlotRenderSignature = "";
    this.sandTexture = null;
    this.sandContext = null;
    this.sandImage = null;
    this.sandImageData = null;
    this.sandPixels = null;
    this.pixelWorldSize = 1;
    this.effectRadius = 2;
  }

  create() {
    this.canvasWidth = this.scale.width;
    this.canvasHeight = this.scale.height;
    this.boardSize = 416;
    this.boardX = (this.canvasWidth - this.boardSize) / 2;
    this.boardY = 24;
    this.boardBottom = this.boardY + this.boardSize;
    this.pixelWorldSize = this.boardSize / gameState.field.width;
    this.effectRadius = Math.max(1.6, this.pixelWorldSize * 1.2);
    this.slotY = this.boardBottom + 78;
    this.slotStep = this.slotWidth + this.slotGap;
    this.beltLoopWidth = this.slotStep * SLOT_COUNT;
    this.beltStartX = (this.canvasWidth - this.beltLoopWidth) / 2;
    this.beltEndX = this.beltStartX + this.beltLoopWidth;

    this.drawFrame();
    this.createSandBitmapLayer();
    this.createBeltMasks();

    sceneRef = this;
    this.syncFromState(gameState);
    renderUI();
  }

  createBeltMasks() {
    this.beltMaskObjects.forEach((object) => object.destroy());
    this.beltMaskObjects = [];

    const maskWidth = 92;
    const maskHeight = 132;
    const maskY = this.slotY + 38;
    const leftMaskX = this.beltStartX - maskWidth / 2 + 8;
    const rightMaskX = this.beltEndX + maskWidth / 2 - 8;

    const leftMask = this.add.rectangle(leftMaskX, maskY, maskWidth, maskHeight, 0xf5e7bf, 1);
    const rightMask = this.add.rectangle(rightMaskX, maskY, maskWidth, maskHeight, 0xf5e7bf, 1);
    const leftPost = this.add.rectangle(this.beltStartX - 10, maskY, 18, maskHeight, 0x8f6845, 1);
    const rightPost = this.add.rectangle(this.beltEndX + 10, maskY, 18, maskHeight, 0x8f6845, 1);

    leftPost.setStrokeStyle(2, 0x6d4c38, 1);
    rightPost.setStrokeStyle(2, 0x6d4c38, 1);

    this.beltMaskObjects.push(leftMask, rightMask, leftPost, rightPost);
    this.bringBeltMasksToTop();
  }

  bringBeltMasksToTop() {
    this.beltMaskObjects.forEach((object) => object.setDepth(1000));
  }

  drawFrame() {
    this.frameObjects.forEach((object) => object.destroy());
    this.frameObjects = [];

    const frame = this.add.rectangle(
      this.canvasWidth / 2,
      this.boardY + this.boardSize / 2,
      this.boardSize + 28,
      this.boardSize + 28,
      0x8f6845
    );
    const backing = this.add.rectangle(
      this.canvasWidth / 2,
      this.boardY + this.boardSize / 2,
      this.boardSize + 14,
      this.boardSize + 14,
      0xf1d495
    );
    const beltBack = this.add.rectangle(this.canvasWidth / 2, this.slotY + 38, this.beltLoopWidth + 28, 92, 0x87664d);
    beltBack.setStrokeStyle(3, 0x6d4c38, 1);
    this.frameObjects.push(frame, backing, beltBack);

    for (let index = 0; index < SLOT_COUNT + 1; index += 1) {
      const x = this.beltStartX + index * this.slotStep - 10;
      const arrow = this.add.triangle(x, this.slotY + 38, -8, -10, -8, 10, 10, 0, 0xd9c09a, 0.46);
      this.frameObjects.push(arrow);
    }
  }

  createSandBitmapLayer() {
    if (this.sandImage) {
      this.sandImage.destroy();
      this.sandImage = null;
    }
    if (this.textures.exists(SAND_TEXTURE_KEY)) {
      this.textures.remove(SAND_TEXTURE_KEY);
    }

    this.sandTexture = this.textures.createCanvas(SAND_TEXTURE_KEY, gameState.field.width, gameState.field.height);
    this.sandContext = this.sandTexture.getContext();
    this.sandContext.imageSmoothingEnabled = false;
    this.sandImageData = this.sandContext.createImageData(gameState.field.width, gameState.field.height);
    this.sandPixels = this.sandImageData.data;
    this.sandImage = this.add.image(this.boardX, this.boardY, SAND_TEXTURE_KEY);
    this.sandImage.setOrigin(0, 0);
    this.sandImage.setDisplaySize(this.boardSize, this.boardSize);
  }

  syncFromState(state) {
    state.field.resetDynamics();
    state.field.markAllDirty();
    this.renderDirtySand();
    this.updateBucketSlots(state.conveyor.slots);
  }

  update(_time, delta) {
    this.beltOffset = Phaser.Math.Wrap(
      this.beltOffset + (currentBeltSpeed() * delta) / 1000,
      0,
      this.beltLoopWidth
    );
    this.positionBucketSlots();
    this.updateSandAutomata(delta);
  }

  positionBucketSlots() {
    this.slotObjects.forEach((container) => {
      const slotIndex = container.getData("slotIndex");
      const center = this.getSlotCenter(slotIndex);
      container.setPosition(center.x, center.y);
    });
  }

  updateBucketSlots(slots) {
    const signature = slots
      .map((bucket) => (bucket === null ? "empty" : `${bucket.color}:${bucket.amount}`))
      .join("|");
    if (signature === this.lastSlotRenderSignature) {
      return;
    }
    this.lastSlotRenderSignature = signature;

    this.slotObjects.forEach((object) => object.destroy());
    this.slotObjects = [];

    slots.forEach((bucket, slotIndex) => {
      const center = this.getSlotCenter(slotIndex);
      const container = this.add.container(center.x, center.y);
      container.setData("slotIndex", slotIndex);
      const background = this.add.rectangle(0, 0, 84, 78, 0xffffff, 0.82);
      background.setStrokeStyle(2, bucket ? colorValue(bucket.color) : 0xc9b18a, bucket ? 0.95 : 0.58);
      container.add(background);

      if (bucket === null) {
        const emptyText = this.add.text(0, 0, `槽 ${slotIndex + 1}`, {
          color: "#8d7462",
          fontFamily: "Microsoft JhengHei, sans-serif",
          fontSize: "16px",
          fontStyle: "bold",
        });
        emptyText.setOrigin(0.5);
        container.add(emptyText);
      } else {
        const bucketBody = this.add.rectangle(0, -8, 42, 38, colorValue(bucket.color));
        bucketBody.setStrokeStyle(2, 0xffffff, 0.42);
        const label = this.add.text(0, 20, `${colorLabel(bucket.color)} ${bucket.amount}/${bucket.capacity}`, {
          color: "#2e332f",
          fontFamily: "Microsoft JhengHei, sans-serif",
          fontSize: "13px",
          fontStyle: "bold",
        });
        label.setOrigin(0.5);

        const meterBack = this.add.rectangle(0, 34, 58, 7, 0xe6ece7);
        const meterFill = this.add.rectangle(-29, 34, 58 * (bucket.amount / bucket.capacity), 7, colorValue(bucket.color));
        meterFill.setOrigin(0, 0.5);
        container.add([bucketBody, label, meterBack, meterFill]);
      }

      this.slotObjects.push(container);
    });

    this.bringBeltMasksToTop();
  }

  getSlotCenter(slotIndex) {
    const wrappedOffset = Phaser.Math.Wrap(slotIndex * this.slotStep + this.beltOffset, 0, this.beltLoopWidth);
    return {
      x: this.beltStartX + wrappedOffset + this.slotWidth / 2,
      y: this.slotY + 38,
    };
  }

  findLeftmostEmptySlot(slots) {
    return slots
      .map((bucket, slotIndex) => {
        if (bucket !== null) {
          return null;
        }

        return {
          slotIndex,
          x: this.getSlotCenter(slotIndex).x,
        };
      })
      .filter((candidate) => candidate !== null)
      .sort((a, b) => a.x - b.x)[0]?.slotIndex ?? -1;
  }

  writePixel(index) {
    const color = gameState.field.getIndex(index);
    const rgba = RGBA_BY_COLOR_ID[color] ?? RGBA_BY_COLOR_ID[EMPTY_COLOR_ID];
    const offset = index * 4;
    this.sandPixels[offset] = rgba[0];
    this.sandPixels[offset + 1] = rgba[1];
    this.sandPixels[offset + 2] = rgba[2];
    this.sandPixels[offset + 3] = rgba[3];
  }

  renderDirtySand() {
    if (!this.sandTexture || !gameState.field.hasDirtyCells()) {
      return;
    }

    gameState.field.consumeDirtyCells().forEach((index) => this.writePixel(index));
    this.sandContext.putImageData(this.sandImageData, 0, 0);
    this.sandTexture.refresh();
  }

  worldXToCellX(worldX) {
    return Phaser.Math.Clamp(Math.floor((worldX - this.boardX) / this.pixelWorldSize), 0, gameState.field.width - 1);
  }

  worldYToCellY(worldY) {
    return Phaser.Math.Clamp(Math.floor((worldY - this.boardY) / this.pixelWorldSize), 0, gameState.field.height - 1);
  }

  cellToWorldPosition(cellX, cellY) {
    return {
      x: this.boardX + (cellX + 0.5) * this.pixelWorldSize,
      y: this.boardY + (cellY + 0.5) * this.pixelWorldSize,
    };
  }

  getBucketLineRange(slotIndex) {
    const slotCenter = this.getSlotCenter(slotIndex);
    if (gameState.field.sideAxis() === "x") {
      return {
        minLine: this.worldXToCellX(slotCenter.x - BUCKET_SUCTION_HALF_WIDTH),
        maxLine: this.worldXToCellX(slotCenter.x + BUCKET_SUCTION_HALF_WIDTH),
        centerLine: this.worldXToCellX(slotCenter.x),
      };
    }

    return {
      minLine: this.worldYToCellY(slotCenter.y - BUCKET_SUCTION_HALF_WIDTH),
      maxLine: this.worldYToCellY(slotCenter.y + BUCKET_SUCTION_HALF_WIDTH),
      centerLine: this.worldYToCellY(slotCenter.y),
    };
  }

  getAvailableColorsInSuctionZone() {
    const colors = new Set();
    gameState.conveyor.slots.forEach((bucket, slotIndex) => {
      if (bucket === null) {
        return;
      }

      const { minLine, maxLine } = this.getBucketLineRange(slotIndex);
      gameState.field.availableColorsInLineRange(minLine, maxLine).forEach((color) => colors.add(color));
    });

    return [...colors];
  }

  hasAnyBucketAbsorbable() {
    return gameState.conveyor.slots.some((bucket, slotIndex) => {
      if (bucket === null || bucket.isFull()) {
        return false;
      }
      return this.findAbsorbableCell(bucket.color, new Set(), slotIndex) !== null;
    });
  }

  findAbsorbableCell(color, reservedCellIndices = new Set(), slotIndex = null) {
    if (slotIndex === null) {
      return null;
    }

    const targetColorId = colorId(color);
    const { minLine, maxLine, centerLine } = this.getBucketLineRange(slotIndex);
    const cell = gameState.field.findAbsorbableCellInLineRange(
      targetColorId,
      minLine,
      maxLine,
      reservedCellIndices,
      centerLine
    );

    if (cell === null) {
      return null;
    }

    return { ...cell, color };
  }

  updateSandAutomata(delta) {
    const stepped = gameState.field.update(delta);
    if (stepped || gameState.field.hasDirtyCells()) {
      this.renderDirtySand();
    }
  }

  spawnAbsorbParticles(fromPosition, toPosition, color) {
    for (let index = 0; index < SUCK_TRAIL_COUNT; index += 1) {
      const particle = this.add.circle(
        fromPosition.x + Phaser.Math.Between(-4, 4),
        fromPosition.y + Phaser.Math.Between(-4, 4),
        Phaser.Math.Between(1, 3),
        colorValue(color),
        0.95
      );
      const delay = index * 4;
      this.tweens.add({
        targets: particle,
        x: toPosition.x + Phaser.Math.Between(-18, 18),
        y: toPosition.y + Phaser.Math.Between(-18, 10),
        alpha: 0,
        scale: 0.35,
        delay,
        duration: SUCK_TRAIL_MS,
        ease: "Cubic.easeIn",
        onComplete: () => particle.destroy(),
      });
    }
  }

  async suckCell(cell, slotIndex) {
    const slotCenter = this.getSlotCenter(slotIndex);
    const fromPosition = this.cellToWorldPosition(cell.cellX, cell.cellY);

    if (!gameState.field.clearIndex(cell.index)) {
      return;
    }

    gameState.field.activateCellNeighborhood(cell.cellX, cell.cellY);
    gameState.field.wakeLocalSand(cell.cellX, cell.cellY);
    this.renderDirtySand();
    this.spawnAbsorbParticles(fromPosition, slotCenter, cell.color);

    const suckedPixel = this.add.rectangle(
      fromPosition.x,
      fromPosition.y,
      Math.max(2, this.pixelWorldSize),
      Math.max(2, this.pixelWorldSize),
      colorValue(cell.color),
      0.96
    );
    await tweenTo(this, suckedPixel, {
      x: slotCenter.x,
      y: slotCenter.y,
      alpha: 0,
      scale: 0.2,
      duration: SUCK_TWEEN_MS,
      ease: "Cubic.easeIn",
      onComplete: () => suckedPixel.destroy(),
    });
  }
}

function availableColors() {
  return sceneRef?.getAvailableColorsInSuctionZone() ?? [];
}

function renderAvailableColors() {
  if (!elements.availableColors || elements.availableColors.closest(".is-hidden")) {
    return;
  }

  elements.availableColors.replaceChildren();
  const colors = sortColors(availableColors());

  if (colors.length === 0) {
    const empty = document.createElement("span");
    empty.className = "swatch is-empty";
    empty.textContent = "無";
    elements.availableColors.append(empty);
    return;
  }

  colors.forEach((color) => {
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.setProperty("--swatch-color", colorHex(color));
    swatch.textContent = colorLabel(color);
    elements.availableColors.append(swatch);
  });
}

function renderBucketPalette() {
  const signature = BUCKET_COLORS.join("|");
  if (bucketButtons.size === 0 || bucketPaletteSignature !== signature) {
    bucketPaletteSignature = signature;
    bucketButtons = new Map();
    elements.bucketPalette.replaceChildren();

    BUCKET_COLORS.forEach((color) => {
      const button = document.createElement("button");
      button.className = "bucket-button";
      button.type = "button";
      button.dataset.color = color;
      button.setAttribute("aria-label", `放入${colorLabel(color)}桶`);

      const icon = document.createElement("span");
      icon.className = "bucket-icon";
      icon.style.setProperty("--bucket-color", colorHex(color));

      const label = document.createElement("span");
      label.className = "bucket-label";
      label.textContent = colorLabel(color);

      button.append(icon, label);
      button.addEventListener("click", () => handleBucketClick(color));
      bucketButtons.set(color, button);
      elements.bucketPalette.append(button);
    });
  }

  updateBucketPaletteState();
}

function updateBucketPaletteState() {
  const disabled = gameState.phase !== "running" || gameState.conveyor.isFull();
  const isCompleted = gameState.field.remainingTotal <= 0 || gameState.phase === "won";
  bucketButtons.forEach((button) => {
    const color = button.dataset.color;
    const label = button.querySelector(".bucket-label");
    button.disabled = disabled;
    button.classList.toggle("is-completed", isCompleted);
    button.setAttribute("aria-label", isCompleted ? "已完成" : `放入${colorLabel(color)}桶`);
    if (label) {
      label.textContent = isCompleted ? "已完成" : colorLabel(color);
    }
  });
}

function renderCompletionOverlay() {
  if (!elements.completionOverlay) {
    return;
  }

  elements.completionOverlay.classList.toggle("is-hidden", gameState.phase !== "won");
}

function renderBeltSpeedButton() {
  if (!elements.beltSpeedButton) {
    return;
  }

  const multiplier = beltSpeedMultiplier();
  elements.beltSpeedButton.textContent = `輸送帶 x${multiplier}`;
  elements.beltSpeedButton.setAttribute("aria-label", `目前輸送帶速度 x${multiplier}，點擊切換速度`);
}

function cycleBeltSpeed() {
  beltSpeedIndex = (beltSpeedIndex + 1) % BELT_SPEED_MULTIPLIERS.length;
  renderBeltSpeedButton();
}

function renderGravityButton() {
  if (!elements.gravityButton) {
    return;
  }

  const direction = gameState?.field.gravityDirection ?? "down";
  const label = gravityLabel(direction);
  elements.gravityButton.textContent = `重力 ${label}`;
  elements.gravityButton.setAttribute("aria-label", `目前重力方向 ${label}，點擊切換方向`);
}

function cycleGravityDirection() {
  if (!gameState?.field) {
    return;
  }

  const currentIndex = GRAVITY_DIRECTIONS.indexOf(gameState.field.gravityDirection);
  const nextDirection = GRAVITY_DIRECTIONS[(currentIndex + 1) % GRAVITY_DIRECTIONS.length] ?? "down";
  gameState.field.rotateGravity(nextDirection);
  renderGravityButton();
  sceneRef?.renderDirtySand();
}

function renderPhase() {
  const label = {
    running: "進行中",
    won: "勝利",
    lost: "失敗",
  }[gameState.phase];

  elements.phasePill.textContent = label;
  elements.phasePill.classList.toggle("is-won", gameState.phase === "won");
  elements.phasePill.classList.toggle("is-lost", gameState.phase === "lost");
}

function renderRemainingByColor() {
  if (!elements.remainingByColor) {
    return;
  }

  elements.remainingByColor.replaceChildren();
  COLOR_ORDER.forEach((color) => {
    const count = gameState.field.colorCounts[colorId(color)] ?? 0;
    const item = document.createElement("span");
    item.className = "remaining-color";
    item.style.setProperty("--sand-color", colorHex(color));
    item.textContent = `${colorLabel(color)} ${count}`;
    elements.remainingByColor.append(item);
  });
}

function renderUI({ updateSlots = true } = {}) {
  elements.remainingValue.textContent = gameState.field.remainingTotal;
  elements.turnValue.textContent = gameState.turn;
  renderPhase();
  renderCompletionOverlay();
  renderRemainingByColor();
  renderGravityButton();
  renderAvailableColors();
  renderBucketPalette();
  if (updateSlots) {
    sceneRef?.updateBucketSlots(gameState.conveyor.slots);
    lastSlotUiRefreshAt = window.performance.now();
  }
}

async function handleBucketClick(color) {
  if (gameState.phase !== "running") {
    return;
  }

  let slotIndex;
  try {
    const preferredSlotIndex = sceneRef?.findLeftmostEmptySlot(gameState.conveyor.slots) ?? null;
    slotIndex = gameState.placeBucket(color, preferredSlotIndex);
  } catch (error) {
    setMessage(error.message);
    return;
  }

  setMessage(`${colorLabel(color)}桶進入槽 ${slotIndex + 1}。`);
  addLog(`放入${colorLabel(color)}桶。`, color);
  renderUI();

  startAbsorptionLoop();
}

function startAbsorptionLoop() {
  if (isAbsorptionLoopRunning) {
    return;
  }

  isAbsorptionLoopRunning = true;
  resolveAbsorption().finally(() => {
    isAbsorptionLoopRunning = false;
    updateEndState();
    renderUI();
  });
}

function updateEndState() {
  gameState.updatePhase(availableColors());

  if (gameState.phase === "won") {
    setMessage("沙畫已清空。");
    addLog("關卡完成。", "green");
  } else if (gameState.phase === "lost") {
    setMessage("死鎖：槽位全滿，沒有水桶符合吸收區顏色。");
    addLog("發生死鎖。", "purple");
  } else if (!isAbsorptionLoopRunning) {
    setMessage("可以繼續放桶。");
  }
}

function removeBucketsWithoutRemainingSand() {
  const removedBuckets = gameState.conveyor.removeBucketsWithoutRemainingSand(gameState.field);
  if (removedBuckets.length === 0) {
    return false;
  }

  const removedText = removedBuckets.map((bucket) => `${colorLabel(bucket.color)}桶`).join("、");
  setMessage(`${removedText} 已沒有對應顏色的沙子，自動離開輸送帶。`);
  removedBuckets.forEach((bucket) => addLog(`${colorLabel(bucket.color)}桶無對應沙子，自動移除。`, bucket.color));
  renderUI();
  return true;
}

async function resolveAbsorption() {
  const pendingAnimations = new Set();

  while (gameState.phase === "running" && gameState.conveyor.activeBuckets().length > 0) {
    if (removeBucketsWithoutRemainingSand()) {
      await sleep(BUCKET_REMOVE_DELAY_MS);
      if (gameState.conveyor.activeBuckets().length === 0) {
        break;
      }
    }

    const reservedCellIndices = new Set();
    let startedThisTick = 0;

    for (const bucket of gameState.conveyor.activeBuckets()) {
      if (bucket.isFull()) {
        continue;
      }

      const slotIndex = gameState.conveyor.findBucketSlot(bucket);
      if (slotIndex === -1) {
        continue;
      }

      const cell = sceneRef?.findAbsorbableCell(bucket.color, reservedCellIndices, slotIndex) ?? null;
      if (cell === null) {
        continue;
      }

      reservedCellIndices.add(cell.index);
      bucket.absorb();

      setMessage("水桶正在吸入正上方底層沙像素。");
      addLog(`${colorLabel(bucket.color)}桶 +${SAND_UNIT_VALUE}。`, bucket.color);
      startedThisTick += 1;

      const animation = sceneRef
        .suckCell(cell, slotIndex)
        .catch(() => undefined)
        .finally(() => {
          pendingAnimations.delete(animation);
        });
      pendingAnimations.add(animation);

      if (gameState.field.isCleared()) {
        gameState.phase = "won";
        break;
      }

      if (gameState.phase !== "running") {
        break;
      }
    }

    if (startedThisTick > 0) {
      const now = window.performance.now();
      if (now - lastSlotUiRefreshAt >= SLOT_UI_REFRESH_MS) {
        sceneRef?.updateBucketSlots(gameState.conveyor.slots);
        lastSlotUiRefreshAt = now;
      }
      await sleep(STREAM_SUCK_INTERVAL_MS);
    } else {
      renderAvailableColors();
      await sleep(IDLE_SCAN_INTERVAL_MS);
    }

    const removedBuckets = gameState.conveyor.removeFullBuckets();
    if (removedBuckets.length > 0) {
      const removedText = removedBuckets.map((bucket) => `${colorLabel(bucket.color)}桶`).join("、");
      setMessage(`${removedText} 已滿，離開輸送帶。`);
      removedBuckets.forEach((bucket) => addLog(`${colorLabel(bucket.color)}桶滿桶消除。`, bucket.color));
      renderUI();
      await sleep(BUCKET_REMOVE_DELAY_MS);
    }

    if (removeBucketsWithoutRemainingSand()) {
      await sleep(BUCKET_REMOVE_DELAY_MS);
    }

    await sleep(ABSORB_ROUND_DELAY_MS);
  }

  if (pendingAnimations.size > 0) {
    await Promise.allSettled([...pendingAnimations]);
  }
}

function resetGame() {
  gameState = new GameState(currentLevelRows);
  isAbsorptionLoopRunning = false;
  lastSlotUiRefreshAt = 0;
  logItems = [];
  setMessage("選擇一個水桶開始。");
  renderLog();
  sceneRef?.syncFromState(gameState);
  renderUI();
}

function bootPhaser() {
  if (!window.Phaser) {
    setMessage("Phaser 載入失敗。請確認瀏覽器可以連線到 CDN，或改用本機版 Phaser。");
    elements.bucketPalette.innerHTML = "";
    return;
  }

  gameState = new GameState(currentLevelRows);
  phaserGame = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "gameCanvas",
    width: 720,
    height: 700,
    backgroundColor: "#f5e7bf",
    scene: SandSorterScene,
    render: {
      antialias: false,
      pixelArt: true,
      roundPixels: true,
    },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
  });
}

renderBeltSpeedButton();
renderGravityButton();
elements.imageUploadInput?.addEventListener("change", handleImageUpload);
elements.gravityButton?.addEventListener("click", cycleGravityDirection);
elements.beltSpeedButton?.addEventListener("click", cycleBeltSpeed);
elements.resetButton.addEventListener("click", resetGame);
bootPhaser();
