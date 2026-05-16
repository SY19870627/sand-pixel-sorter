const SAND_UNIT_VALUE = 1;
const BUCKET_CAPACITY = 100;
const SLOT_COUNT = 5;
const SOURCE_IMAGE_SIZE = 128;
const BELT_SPEED_MULTIPLIERS = [1, 2, 3];
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

const COLOR_DATA = {
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

const COLOR_ORDER = ["sky", "brown", "skin", "dark", "white", "red"];
const BUCKET_COLORS = ["sky", "brown", "skin", "dark", "white", "red"];
const COLOR_ID_BY_KEY = new Map(COLOR_ORDER.map((color, index) => [color, index + 1]));
const COLOR_KEY_BY_ID = ["empty", ...COLOR_ORDER];

const RGBA_BY_COLOR_ID = (() => {
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
  return rgba;
})();

const elements = {
  beltSpeedButton: document.querySelector("#beltSpeedButton"),
  resetButton: document.querySelector("#resetButton"),
  phasePill: document.querySelector("#phasePill"),
  remainingValue: document.querySelector("#remainingValue"),
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

const LEVEL_ROWS = createSourcePainting();

function beltSpeedMultiplier() {
  return BELT_SPEED_MULTIPLIERS[beltSpeedIndex] ?? 1;
}

function currentBeltSpeed() {
  return BELT_SPEED_PX_PER_SECOND * beltSpeedMultiplier();
}

function colorId(color) {
  return COLOR_ID_BY_KEY.get(color) ?? EMPTY_COLOR_ID;
}

function colorFromId(id) {
  return COLOR_KEY_BY_ID[id] ?? null;
}

class SandField {
  constructor(rows) {
    this.height = rows.length;
    this.width = rows[0]?.length ?? 0;
    this.colorGrid = new Uint8Array(this.width * this.height);
    this.remainingTotal = 0;

    rows.forEach((row, rowIndex) => {
      if (row.length !== this.width) {
        throw new Error(`第 ${rowIndex + 1} 列寬度不一致。`);
      }

      row.forEach((color, columnIndex) => {
        const id = colorId(color);
        this.colorGrid[this.index(columnIndex, rowIndex)] = id;
        if (id !== EMPTY_COLOR_ID) {
          this.remainingTotal += SAND_UNIT_VALUE;
        }
      });
    });
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

  clearIndex(index) {
    if (!this.isInsideIndex(index) || this.colorGrid[index] === EMPTY_COLOR_ID) {
      return false;
    }

    this.colorGrid[index] = EMPTY_COLOR_ID;
    this.remainingTotal = Math.max(0, this.remainingTotal - SAND_UNIT_VALUE);
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
    this.field = new SandField(rows);
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
    this.activeCells = new Set();
    this.dirtyCells = new Set();
    this.sandAccumulator = 0;
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
    this.activeCells.clear();
    this.dirtyCells.clear();
    this.sandAccumulator = 0;
    this.markAllSandDirty(state.field);
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

  markAllSandDirty(field) {
    for (let index = 0; index < field.colorGrid.length; index += 1) {
      this.dirtyCells.add(index);
    }
  }

  markDirty(index) {
    if (gameState.field.isInsideIndex(index)) {
      this.dirtyCells.add(index);
    }
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
    if (this.dirtyCells.size === 0 || !this.sandTexture) {
      return;
    }

    this.dirtyCells.forEach((index) => this.writePixel(index));
    this.dirtyCells.clear();
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

  getBucketColumnRange(slotIndex) {
    const slotCenter = this.getSlotCenter(slotIndex);
    return {
      minX: this.worldXToCellX(slotCenter.x - BUCKET_SUCTION_HALF_WIDTH),
      maxX: this.worldXToCellX(slotCenter.x + BUCKET_SUCTION_HALF_WIDTH),
    };
  }

  getBottomSandIndexInColumn(cellX) {
    for (let cellY = gameState.field.height - 1; cellY >= 0; cellY -= 1) {
      const index = gameState.field.index(cellX, cellY);
      if (gameState.field.getIndex(index) !== EMPTY_COLOR_ID) {
        return index;
      }
    }
    return null;
  }

  getAvailableColorsInSuctionZone() {
    const colors = new Set();
    gameState.conveyor.slots.forEach((bucket, slotIndex) => {
      if (bucket === null) {
        return;
      }

      const { minX, maxX } = this.getBucketColumnRange(slotIndex);
      for (let cellX = minX; cellX <= maxX; cellX += 1) {
        const index = this.getBottomSandIndexInColumn(cellX);
        if (index === null) {
          continue;
        }

        const color = colorFromId(gameState.field.getIndex(index));
        if (color !== null) {
          colors.add(color);
        }
      }
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
    const slotCenter = this.getSlotCenter(slotIndex);
    const { minX, maxX } = this.getBucketColumnRange(slotIndex);
    let bestCell = null;
    let bestY = -Infinity;
    let bestDistance = Infinity;

    for (let cellX = minX; cellX <= maxX; cellX += 1) {
      const index = this.getBottomSandIndexInColumn(cellX);
      if (index === null || reservedCellIndices.has(index) || gameState.field.getIndex(index) !== targetColorId) {
        continue;
      }

      const cellY = gameState.field.cellY(index);
      const worldPosition = this.cellToWorldPosition(cellX, cellY);
      const distance = Math.abs(worldPosition.x - slotCenter.x);
      if (cellY > bestY || (cellY === bestY && distance < bestDistance)) {
        bestCell = {
          index,
          id: index,
          cellX,
          cellY,
          color,
          colorId: targetColorId,
        };
        bestY = cellY;
        bestDistance = distance;
      }
    }

    return bestCell;
  }

  activateCell(cellX, cellY) {
    if (!gameState.field.isInsideCell(cellX, cellY)) {
      return;
    }
    this.activeCells.add(gameState.field.index(cellX, cellY));
  }

  activateCellNeighborhood(cellX, cellY) {
    for (let offsetY = -2; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        this.activateCell(cellX + offsetX, cellY + offsetY);
      }
    }
  }

  wakeLocalSand(cellX, cellY) {
    for (let y = cellY - WAKE_ABOVE_ROWS; y <= cellY + WAKE_BELOW_ROWS; y += 1) {
      for (let x = cellX - WAKE_COLUMN_RADIUS; x <= cellX + WAKE_COLUMN_RADIUS; x += 1) {
        this.activateCell(x, y);
      }
    }
  }

  tryMoveCell(index) {
    const color = gameState.field.getIndex(index);
    if (color === EMPTY_COLOR_ID) {
      return false;
    }

    const cellX = gameState.field.cellX(index);
    const cellY = gameState.field.cellY(index);
    if (cellY >= gameState.field.height - 1) {
      return false;
    }

    const candidates = [{ x: cellX, y: cellY + 1 }];
    const diagonalOrder = Phaser.Math.Between(0, 1) === 0 ? [-1, 1] : [1, -1];
    diagonalOrder.forEach((direction) => {
      candidates.push({ x: cellX + direction, y: cellY + 1 });
    });

    for (const candidate of candidates) {
      if (!gameState.field.isCellEmpty(candidate.x, candidate.y)) {
        continue;
      }

      const targetIndex = gameState.field.index(candidate.x, candidate.y);
      if (!gameState.field.moveIndex(index, targetIndex)) {
        continue;
      }

      this.markDirty(index);
      this.markDirty(targetIndex);
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
      const rowDelta = gameState.field.cellY(b) - gameState.field.cellY(a);
      return rowDelta !== 0 ? rowDelta : Phaser.Math.Between(-1, 1);
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

  updateSandAutomata(delta) {
    this.sandAccumulator += delta;
    let stepped = false;
    let stepCount = 0;
    while (this.sandAccumulator >= SAND_STEP_MS && stepCount < SAND_STEPS_PER_FRAME) {
      this.sandAccumulator -= SAND_STEP_MS;
      stepped = this.stepActiveSand() || stepped;
      stepCount += 1;
    }

    if (stepped || this.dirtyCells.size > 0) {
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

    this.markDirty(cell.index);
    this.activateCellNeighborhood(cell.cellX, cell.cellY);
    this.wakeLocalSand(cell.cellX, cell.cellY);
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
  if (bucketButtons.size === 0) {
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
  bucketButtons.forEach((button) => {
    button.disabled = disabled;
  });
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

function renderUI({ updateSlots = true } = {}) {
  elements.remainingValue.textContent = gameState.field.remainingTotal;
  elements.turnValue.textContent = gameState.turn;
  renderPhase();
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

async function resolveAbsorption() {
  const pendingAnimations = new Set();

  while (gameState.phase === "running" && gameState.conveyor.activeBuckets().length > 0) {
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

    await sleep(ABSORB_ROUND_DELAY_MS);
  }

  if (pendingAnimations.size > 0) {
    await Promise.allSettled([...pendingAnimations]);
  }
}

function resetGame() {
  gameState = new GameState(LEVEL_ROWS);
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

  gameState = new GameState(LEVEL_ROWS);
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
elements.beltSpeedButton?.addEventListener("click", cycleBeltSpeed);
elements.resetButton.addEventListener("click", resetGame);
bootPhaser();
