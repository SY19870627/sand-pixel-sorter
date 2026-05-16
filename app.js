const SAND_UNIT_VALUE = 10;
const BUCKET_CAPACITY = 100;
const SLOT_COUNT = 5;
const PIXEL_SCALE = 3;
const SUCTION_ZONE_HEIGHT = 116;
const SUCK_TWEEN_MS = 68;
const SUCK_TRAIL_MS = 120;
const SUCK_TRAIL_COUNT = 7;
const ABSORB_ROUND_DELAY_MS = 6;
const BUCKET_REMOVE_DELAY_MS = 36;
const BELT_SPEED_PX_PER_SECOND = 54;
const BUCKET_SUCTION_HALF_WIDTH = 22;
const BOTTOM_LAYER_MARGIN = 54;
const STREAM_SUCK_INTERVAL_MS = 12;
const IDLE_SCAN_INTERVAL_MS = 48;
const SLOT_UI_REFRESH_MS = 140;
const CA_STEP_MS = 24;
const CA_MAX_STEPS_PER_FRAME = 3;
const CA_WAKE_COLUMN_RADIUS = 4;
const CA_WAKE_ABOVE_ROWS = 24;
const CA_WAKE_BELOW_ROWS = 2;
const CA_RENDER_LERP = 0.42;

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

const COLOR_ORDER = ["sky", "brown", "skin", "dark", "white", "red", "yellow", "blue", "green", "purple"];
const BUCKET_COLORS = ["sky", "brown", "skin", "dark", "white", "red", "yellow", "blue"];

const PAINTING_ROWS = [
  "ssssssssssssssss",
  "ssssbbbbbbbbssss",
  "sssbbbbbbbbbbsss",
  "ssbbbbbbbbbbbbss",
  "ssbbddddddddbbss",
  "sbbddkkkkkkddbbs",
  "sbbddkwwkkwddbbs",
  "sbbddkkkkkkddbbs",
  "ssbddkkrrkkddbss",
  "sssbddkkkkddbsss",
  "ssssbddddddbssss",
  "sssyyybbbbbyysss",
  "sssyyybbbbbyysss",
  "ssssyyyyyyyyssss",
  "ssssggggggggssss",
  "ssssgggssssgggss",
];

const PAINTING_COLOR_KEY = {
  s: "sky",
  b: "brown",
  d: "skin",
  k: "dark",
  w: "white",
  r: "red",
  y: "yellow",
  g: "blue",
};

const elements = {
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

function upscalePainting(patternRows, scale) {
  const expandedRows = [];
  patternRows.forEach((row) => {
    const expandedRow = [...row].map((symbol) => symbol.repeat(scale)).join("");
    for (let repeatIndex = 0; repeatIndex < scale; repeatIndex += 1) {
      expandedRows.push(expandedRow);
    }
  });
  return expandedRows;
}

function buildPaintingLevel(patternRows) {
  return patternRows.map((row) => [...row].map((symbol) => PAINTING_COLOR_KEY[symbol] ?? "sky"));
}

const LEVEL_ROWS = buildPaintingLevel(upscalePainting(PAINTING_ROWS, PIXEL_SCALE));

class SandParticle {
  constructor({ id, color, gridX, gridY }) {
    this.id = id;
    this.color = color;
    this.gridX = gridX;
    this.gridY = gridY;
    this.cellX = gridX;
    this.cellY = gridY;
    this.x = gridX;
    this.y = gridY;
    this.targetX = gridX;
    this.targetY = gridY;
    this.offsetX = 0;
    this.offsetY = 0;
    this.state = "active";
    this.sprite = null;
    this.mode = "static";
    this.hasWorldPosition = false;
  }
}

class SandField {
  constructor(rows) {
    this.height = rows.length;
    this.width = rows[0]?.length ?? 0;
    this.cells = Array.from({ length: this.height }, () => Array.from({ length: this.width }, () => null));
    this.particles = [];
    this.remainingTotal = 0;

    rows.forEach((row, rowIndex) => {
      if (row.length !== this.width) {
        throw new Error(`第 ${rowIndex + 1} 列寬度不一致。`);
      }

      row.forEach((color, columnIndex) => {
        const particle = new SandParticle({
          id: this.particles.length,
          color,
          gridX: columnIndex,
          gridY: rowIndex,
        });
        this.particles.push(particle);
        this.cells[rowIndex][columnIndex] = particle;
        this.remainingTotal += SAND_UNIT_VALUE;
      });
    });
  }

  activeParticles() {
    return this.particles.filter((particle) => particle.state === "active");
  }

  markSucked(particle) {
    if (particle.state !== "active") {
      return;
    }
    if (this.cells[particle.cellY]?.[particle.cellX] === particle) {
      this.cells[particle.cellY][particle.cellX] = null;
    }
    particle.state = "sucked";
    this.remainingTotal = Math.max(0, this.remainingTotal - SAND_UNIT_VALUE);
  }

  isInsideCell(cellX, cellY) {
    return cellX >= 0 && cellX < this.width && cellY >= 0 && cellY < this.height;
  }

  isCellEmpty(cellX, cellY) {
    return this.isInsideCell(cellX, cellY) && this.cells[cellY][cellX] === null;
  }

  moveParticleToCell(particle, cellX, cellY) {
    if (!this.isInsideCell(cellX, cellY) || !this.isCellEmpty(cellX, cellY)) {
      return false;
    }

    if (this.cells[particle.cellY]?.[particle.cellX] === particle) {
      this.cells[particle.cellY][particle.cellX] = null;
    }
    this.cells[cellY][cellX] = particle;
    particle.cellX = cellX;
    particle.cellY = cellY;
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
    this.ballRadius = 4.05;
    this.ballSpacing = 8.75;
    this.beltOffset = 0;
    this.slotWidth = 92;
    this.slotGap = 14;
    this.lastSlotRenderSignature = "";
    this.staticSandLayer = null;
    this.caAccumulator = 0;
    this.activeCellKeys = new Set();
  }

  create() {
    this.canvasWidth = this.scale.width;
    this.canvasHeight = this.scale.height;
    this.boardSize = LEVEL_ROWS[0].length * this.ballSpacing;
    this.boardX = (this.canvasWidth - this.boardSize) / 2;
    this.boardY = 24;
    this.boardBottom = this.boardY + this.boardSize;
    this.suctionTopY = this.boardBottom - SUCTION_ZONE_HEIGHT;
    this.slotY = this.boardBottom + 78;
    this.slotStep = this.slotWidth + this.slotGap;
    this.beltLoopWidth = this.slotStep * SLOT_COUNT;
    this.beltStartX = (this.canvasWidth - this.beltLoopWidth) / 2;
    this.beltEndX = this.beltStartX + this.beltLoopWidth;

    this.matter.world.setGravity(0, 0.72);
    this.drawFrame();
    this.createStaticSandLayer();
    this.createBoundaries();
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
    const suctionZone = this.add.rectangle(
      this.canvasWidth / 2,
      this.suctionTopY + SUCTION_ZONE_HEIGHT / 2,
      this.boardSize,
      SUCTION_ZONE_HEIGHT,
      0xffffff,
      0.12
    );
    suctionZone.setStrokeStyle(2, 0xffffff, 0.18);
    const beltBack = this.add.rectangle(this.canvasWidth / 2, this.slotY + 38, this.beltLoopWidth + 28, 92, 0x87664d);
    beltBack.setStrokeStyle(3, 0x6d4c38, 1);
    this.frameObjects.push(frame, backing, suctionZone, beltBack);

    for (let index = 0; index < SLOT_COUNT + 1; index += 1) {
      const x = this.beltStartX + index * this.slotStep - 10;
      const arrow = this.add.triangle(x, this.slotY + 38, -8, -10, -8, 10, 10, 0, 0xd9c09a, 0.46);
      this.frameObjects.push(arrow);
    }
  }

  createBoundaries() {
    const thickness = 28;
    const left = this.boardX - thickness / 2;
    const right = this.boardX + this.boardSize + thickness / 2;
    const centerX = this.boardX + this.boardSize / 2;
    const centerY = this.boardY + this.boardSize / 2;
    const bottom = this.boardBottom + thickness / 2;
    const top = this.boardY - thickness / 2;

    this.matter.add.rectangle(left, centerY, thickness, this.boardSize + thickness * 2, { isStatic: true });
    this.matter.add.rectangle(right, centerY, thickness, this.boardSize + thickness * 2, { isStatic: true });
    this.matter.add.rectangle(centerX, bottom, this.boardSize + thickness * 2, thickness, { isStatic: true });
    this.matter.add.rectangle(centerX, top, this.boardSize + thickness * 2, thickness, { isStatic: true });
  }

  createStaticSandLayer() {
    this.staticSandLayer?.destroy();
    this.staticSandLayer = this.add.graphics();
  }

  getCellWorldPosition(cellX, cellY, particle = null) {
    const stagger = cellY % 2 === 0 ? 0 : this.ballSpacing * 0.22;
    return {
      x: this.boardX + cellX * this.ballSpacing + this.ballRadius + stagger + (particle?.offsetX ?? 0),
      y: this.boardY + cellY * this.ballSpacing + this.ballRadius + (particle?.offsetY ?? 0),
    };
  }

  getInitialParticlePosition(particle) {
    particle.offsetX = Phaser.Math.FloatBetween(-0.8, 0.8);
    particle.offsetY = Phaser.Math.FloatBetween(-0.8, 0.8);
    return this.getCellWorldPosition(particle.cellX, particle.cellY, particle);
  }

  ensureParticleWorldPosition(particle) {
    if (particle.hasWorldPosition) {
      return;
    }

    const position = this.getInitialParticlePosition(particle);
    particle.x = position.x;
    particle.y = position.y;
    particle.targetX = position.x;
    particle.targetY = position.y;
    particle.hasWorldPosition = true;
  }

  getParticlePosition(particle) {
    if (particle.sprite) {
      return {
        x: particle.sprite.x,
        y: particle.sprite.y,
      };
    }

    this.ensureParticleWorldPosition(particle);
    return {
      x: particle.x,
      y: particle.y,
    };
  }

  renderStaticSand() {
    if (!this.staticSandLayer) {
      return;
    }

    this.staticSandLayer.clear();
    for (const particle of gameState.field.particles) {
      if (particle.state !== "active" || particle.mode !== "static") {
        continue;
      }

      this.ensureParticleWorldPosition(particle);
      particle.x += (particle.targetX - particle.x) * CA_RENDER_LERP;
      particle.y += (particle.targetY - particle.y) * CA_RENDER_LERP;
      if (Math.abs(particle.targetX - particle.x) < 0.08) {
        particle.x = particle.targetX;
      }
      if (Math.abs(particle.targetY - particle.y) < 0.08) {
        particle.y = particle.targetY;
      }
      this.staticSandLayer.fillStyle(colorValue(particle.color), 0.96);
      this.staticSandLayer.fillCircle(particle.x, particle.y, this.ballRadius);
    }
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

  syncFromState(state) {
    this.activeCellKeys.clear();
    this.caAccumulator = 0;
    state.field.particles.forEach((particle) => {
      if (particle.sprite?.body) {
        this.matter.world.remove(particle.sprite.body);
      }
      particle.sprite?.destroy();
      particle.sprite = null;
      if (particle.state === "sucked") {
        return;
      }

      this.ensureParticleWorldPosition(particle);
      const target = this.getCellWorldPosition(particle.cellX, particle.cellY, particle);
      particle.x = target.x;
      particle.y = target.y;
      particle.targetX = target.x;
      particle.targetY = target.y;
      particle.mode = "static";
    });
    this.renderStaticSand();
    this.updateBucketSlots(state.conveyor.slots);
  }

  update(_time, delta) {
    this.beltOffset = Phaser.Math.Wrap(
      this.beltOffset + (BELT_SPEED_PX_PER_SECOND * delta) / 1000,
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

  getAvailableColorsInSuctionZone() {
    const colors = new Set();
    gameState.conveyor.slots.forEach((bucket, slotIndex) => {
      if (bucket === null) {
        return;
      }

      const slotCenter = this.getSlotCenter(slotIndex);
      for (const particle of gameState.field.particles) {
        if (particle.state !== "active") {
          continue;
        }
        if (this.isParticleInBucketColumn(particle, slotCenter.x)) {
          colors.add(particle.color);
        }
      }
    });

    return [...colors];
  }

  isParticleInBucketColumn(particle, bucketX) {
    if (particle.state !== "active") {
      return false;
    }

    const { x: particleX, y: particleY } = this.getParticlePosition(particle);

    return (
      Math.abs(particleX - bucketX) <= BUCKET_SUCTION_HALF_WIDTH &&
      particleY >= this.boardBottom - BOTTOM_LAYER_MARGIN &&
      particleY <= this.boardBottom + this.ballRadius * 2
    );
  }

  hasAnyBucketAbsorbable() {
    return gameState.conveyor.slots.some((bucket, slotIndex) => {
      if (bucket === null || bucket.isFull()) {
        return false;
      }
      return this.findAbsorbableParticle(bucket.color, new Set(), slotIndex) !== null;
    });
  }

  findAbsorbableParticle(color, reservedParticleIds = new Set(), slotIndex = null) {
    if (slotIndex === null) {
      return null;
    }

    const slotCenter = this.getSlotCenter(slotIndex);
    let bestParticle = null;
    let bestY = -Infinity;
    let bestX = -Infinity;

    for (const particle of gameState.field.particles) {
      if (
        particle.state !== "active" ||
        particle.color !== color ||
        reservedParticleIds.has(particle.id) ||
        !this.isParticleInBucketColumn(particle, slotCenter.x)
      ) {
        continue;
      }

      const { x: particleX, y: particleY } = this.getParticlePosition(particle);
      if (particleY > bestY || (particleY === bestY && particleX > bestX)) {
        bestParticle = particle;
        bestY = particleY;
        bestX = particleX;
      }
    }

    return bestParticle;
  }

  getCellKey(cellX, cellY) {
    return `${cellX},${cellY}`;
  }

  parseCellKey(key) {
    const [cellX, cellY] = key.split(",").map(Number);
    return { cellX, cellY };
  }

  activateCell(cellX, cellY) {
    if (!gameState.field.isInsideCell(cellX, cellY)) {
      return;
    }
    this.activeCellKeys.add(this.getCellKey(cellX, cellY));
  }

  activateCellNeighborhood(cellX, cellY) {
    for (let offsetY = -2; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        this.activateCell(cellX + offsetX, cellY + offsetY);
      }
    }
  }

  updateParticleTarget(particle) {
    const target = this.getCellWorldPosition(particle.cellX, particle.cellY, particle);
    particle.targetX = target.x;
    particle.targetY = target.y;
  }

  tryMoveParticle(particle) {
    const candidates = [{ x: particle.cellX, y: particle.cellY + 1 }];
    const diagonalOrder = Phaser.Math.Between(0, 1) === 0 ? [-1, 1] : [1, -1];
    diagonalOrder.forEach((direction) => {
      candidates.push({ x: particle.cellX + direction, y: particle.cellY + 1 });
    });

    for (const candidate of candidates) {
      if (!gameState.field.isCellEmpty(candidate.x, candidate.y)) {
        continue;
      }

      const oldX = particle.cellX;
      const oldY = particle.cellY;
      if (!gameState.field.moveParticleToCell(particle, candidate.x, candidate.y)) {
        continue;
      }

      this.updateParticleTarget(particle);
      this.activateCellNeighborhood(oldX, oldY);
      this.activateCellNeighborhood(particle.cellX, particle.cellY);
      return true;
    }

    return false;
  }

  stepActiveSand() {
    if (this.activeCellKeys.size === 0) {
      return false;
    }

    const activeCells = [...this.activeCellKeys]
      .map((key) => this.parseCellKey(key))
      .sort((a, b) => b.cellY - a.cellY || Phaser.Math.Between(-1, 1));
    this.activeCellKeys.clear();

    let movedAny = false;
    const movedParticleIds = new Set();
    for (const cell of activeCells) {
      const particle = gameState.field.cells[cell.cellY]?.[cell.cellX] ?? null;
      if (!particle || particle.state !== "active" || movedParticleIds.has(particle.id)) {
        continue;
      }

      if (this.tryMoveParticle(particle)) {
        movedParticleIds.add(particle.id);
        movedAny = true;
      }
    }

    return movedAny;
  }

  hasAnimatingSand() {
    return gameState.field.particles.some((particle) => {
      return (
        particle.state === "active" &&
        (Math.abs((particle.targetX ?? particle.x) - particle.x) > 0.08 ||
          Math.abs((particle.targetY ?? particle.y) - particle.y) > 0.08)
      );
    });
  }

  updateSandAutomata(delta) {
    this.caAccumulator += delta;
    let stepped = false;
    let stepCount = 0;
    while (this.caAccumulator >= CA_STEP_MS && stepCount < CA_MAX_STEPS_PER_FRAME) {
      this.caAccumulator -= CA_STEP_MS;
      stepped = this.stepActiveSand() || stepped;
      stepCount += 1;
    }

    if (stepped || this.activeCellKeys.size > 0 || this.hasAnimatingSand()) {
      this.renderStaticSand();
    }
  }

  wakeLocalSand(originPosition, excludedParticleId = null) {
    const centerCellX = Phaser.Math.Clamp(
      Math.round((originPosition.x - this.boardX - this.ballRadius) / this.ballSpacing),
      0,
      gameState.field.width - 1
    );
    const centerCellY = Phaser.Math.Clamp(
      Math.round((originPosition.y - this.boardY - this.ballRadius) / this.ballSpacing),
      0,
      gameState.field.height - 1
    );

    for (let y = centerCellY - CA_WAKE_ABOVE_ROWS; y <= centerCellY + CA_WAKE_BELOW_ROWS; y += 1) {
      for (let x = centerCellX - CA_WAKE_COLUMN_RADIUS; x <= centerCellX + CA_WAKE_COLUMN_RADIUS; x += 1) {
        const particle = gameState.field.cells[y]?.[x] ?? null;
        if (particle?.id === excludedParticleId) {
          continue;
        }
        this.activateCell(x, y);
      }
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

  async suckParticle(particle, slotIndex) {
    const slotCenter = this.getSlotCenter(slotIndex);
    const fromPosition = this.getParticlePosition(particle);
    const sprite = particle.sprite;
    this.wakeLocalSand(fromPosition, particle.id);
    gameState.field.markSucked(particle);
    this.activateCellNeighborhood(particle.cellX, particle.cellY);
    particle.mode = "sucked";

    if (sprite?.body) {
      this.matter.world.remove(sprite.body);
    }
    particle.sprite = null;
    this.renderStaticSand();
    this.spawnAbsorbParticles(fromPosition, slotCenter, particle.color);

    const suckedSprite = sprite ?? this.add.circle(fromPosition.x, fromPosition.y, this.ballRadius, colorValue(particle.color), 0.96);
    await tweenTo(this, suckedSprite, {
      x: slotCenter.x,
      y: slotCenter.y,
      alpha: 0,
      scale: 0.2,
      duration: SUCK_TWEEN_MS,
      ease: "Cubic.easeIn",
      onComplete: () => suckedSprite.destroy(),
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
    const reservedParticleIds = new Set();
    let startedThisTick = 0;

    for (const bucket of gameState.conveyor.activeBuckets()) {
      if (bucket.isFull()) {
        continue;
      }

      const slotIndex = gameState.conveyor.findBucketSlot(bucket);
      if (slotIndex === -1) {
        continue;
      }

      const particle = sceneRef?.findAbsorbableParticle(bucket.color, reservedParticleIds, slotIndex) ?? null;
      if (particle === null) {
        continue;
      }

      reservedParticleIds.add(particle.id);
      bucket.absorb();

      setMessage("水桶正在吸入正上方底層沙球。");
      addLog(`${colorLabel(bucket.color)}桶 +${SAND_UNIT_VALUE}。`, bucket.color);
      startedThisTick += 1;

      const animation = sceneRef
        .suckParticle(particle, slotIndex)
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
      // 水桶進度採用節流刷新，避免每吸一顆沙都重建槽位圖形。
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
    physics: {
      default: "matter",
      matter: {
        gravity: { y: 0.72 },
        // 沙粒已改由 Active-Set CA 處理；Matter 保留給邊界與未來少量動態道具。
        enableSleeping: true,
        debug: false,
        positionIterations: 4,
        velocityIterations: 3,
      },
    },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
  });
}

elements.resetButton.addEventListener("click", resetGame);
bootPhaser();
