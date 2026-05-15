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
const MAX_NEIGHBOR_DISTURB = 14;
const SLOT_UI_REFRESH_MS = 140;

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
    this.x = gridX;
    this.y = gridY;
    this.state = "active";
    this.sprite = null;
  }
}

class SandField {
  constructor(rows) {
    this.height = rows.length;
    this.width = rows[0]?.length ?? 0;
    this.particles = [];
    this.remainingTotal = 0;

    rows.forEach((row, rowIndex) => {
      if (row.length !== this.width) {
        throw new Error(`第 ${rowIndex + 1} 列寬度不一致。`);
      }

      row.forEach((color, columnIndex) => {
        this.particles.push(
          new SandParticle({
            id: this.particles.length,
            color,
            gridX: columnIndex,
            gridY: rowIndex,
          })
        );
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
    particle.state = "sucked";
    this.remainingTotal = Math.max(0, this.remainingTotal - SAND_UNIT_VALUE);
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

  getInitialParticlePosition(particle) {
    const stagger = particle.gridY % 2 === 0 ? 0 : this.ballSpacing * 0.22;
    return {
      x: this.boardX + particle.gridX * this.ballSpacing + this.ballRadius + stagger + Phaser.Math.FloatBetween(-0.8, 0.8),
      y: this.boardY + particle.gridY * this.ballSpacing + this.ballRadius + Phaser.Math.FloatBetween(-0.8, 0.8),
    };
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

  createParticleBody(particle) {
    const position = this.getInitialParticlePosition(particle);
    const ball = this.add.circle(position.x, position.y, this.ballRadius, colorValue(particle.color));
    // 沙粒數量變多時，外框線會明顯增加繪製成本；細沙改用純色圓點維持流暢度。
    if (this.ballRadius >= 5.5) {
      ball.setStrokeStyle(1, 0xffffff, 0.2);
    }
    ball.setData("particleId", particle.id);
    ball.setData("color", particle.color);

    this.matter.add.gameObject(ball, {
      shape: { type: "circle", radius: this.ballRadius },
      friction: 0.82,
      frictionStatic: 0.92,
      frictionAir: 0.045,
      restitution: 0.005,
      density: 0.0022,
      slop: 0.02,
    });
    ball.setBounce(0.005);
    ball.setFriction(0.82, 0.92, 0.045);

    particle.sprite = ball;
    particle.x = ball.x;
    particle.y = ball.y;
    particle.state = "active";
  }

  syncFromState(state) {
    state.field.particles.forEach((particle) => {
      particle.sprite?.destroy();
      particle.sprite = null;
      if (particle.state !== "sucked") {
        this.createParticleBody(particle);
      }
    });
    this.updateBucketSlots(state.conveyor.slots);
  }

  update(_time, delta) {
    this.beltOffset = Phaser.Math.Wrap(
      this.beltOffset + (BELT_SPEED_PX_PER_SECOND * delta) / 1000,
      0,
      this.beltLoopWidth
    );
    this.positionBucketSlots();
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
    if (!particle.sprite) {
      return false;
    }

    const particleX = particle.sprite.x;
    const particleY = particle.sprite.y;

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

      const particleY = particle.sprite.y;
      const particleX = particle.sprite.x;
      if (particleY > bestY || (particleY === bestY && particleX > bestX)) {
        bestParticle = particle;
        bestY = particleY;
        bestX = particleX;
      }
    }

    return bestParticle;
  }

  disturbNeighbors(originParticle) {
    if (!originParticle.sprite) {
      return;
    }

    const originX = originParticle.sprite.x;
    const originY = originParticle.sprite.y;
    let disturbedCount = 0;

    for (const particle of gameState.field.particles) {
      if (disturbedCount >= MAX_NEIGHBOR_DISTURB) {
        break;
      }
      if (!particle.sprite || particle.id === originParticle.id) {
        continue;
      }

      const dx = particle.sprite.x - originX;
      const dy = particle.sprite.y - originY;
      if (Math.abs(dx) > this.ballSpacing * 3 || dy < -this.ballSpacing * 7 || dy > this.ballSpacing * 2) {
        continue;
      }

      const side = dx === 0 ? Phaser.Math.RND.pick([-1, 1]) : Math.sign(dx);
      const force = {
        x: side * Phaser.Math.FloatBetween(0.00025, 0.00075),
        y: Phaser.Math.FloatBetween(-0.00025, 0.00005),
      };

      if (typeof particle.sprite.applyForce === "function") {
        particle.sprite.applyForce(force);
      } else {
        this.matter.body.applyForce(particle.sprite.body, particle.sprite.body.position, force);
      }
      disturbedCount += 1;
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
    const sprite = particle.sprite;
    if (!sprite) {
      return;
    }

    const fromPosition = { x: sprite.x, y: sprite.y };
    this.disturbNeighbors(particle);
    gameState.field.markSucked(particle);

    this.matter.world.remove(sprite.body);
    particle.sprite = null;
    this.spawnAbsorbParticles(fromPosition, slotCenter, particle.color);

    await tweenTo(this, sprite, {
      x: slotCenter.x,
      y: slotCenter.y,
      alpha: 0,
      scale: 0.2,
      duration: SUCK_TWEEN_MS,
      ease: "Cubic.easeIn",
      onComplete: () => sprite.destroy(),
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
        // 沙子不能進入物理休眠；底層被吸走後，上方沙粒必須立刻受重力影響往下流。
        enableSleeping: false,
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
