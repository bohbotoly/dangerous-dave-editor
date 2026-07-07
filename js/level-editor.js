// Level Editor - Canvas-based 100x10 grid editor
import {
  LEVEL_WIDTH, LEVEL_HEIGHT, TILE_SIZE, VIEWPORT_WIDTH, VIEWPORT_HEIGHT,
  LEVEL_TILE_COUNT
} from './constants.js';
import { getTile, setTile } from './exe-parser.js';
import { tileToCanvasOpaque } from './tileset-parser.js';
import { vgaTileToCanvas as _vgaTileToCanvas } from './vga-parser.js';

let displayScale = 2; // dynamic, recalculated to fit container

let canvas, ctx;
let minimapCanvas, minimapCtx;
let currentLevel = null;
let tileset = null;
let tileCanvasCache = [];    // level tile canvases (VGA when available, EGA fallback)
let spriteCanvasCache = {};  // VGA sprite canvases keyed by VGA tile index
let selectedTile = 1;
let currentTool = 'paint';
let showGrid = true;
let showViewport = false;
let isPainting = false;
let undoStack = [];
let redoStack = [];
let onCursorMove = null;
let gameData = null;
let vgaTileset = null;
let vgaDecompressed = null;
let vgaPalette = null;

export function initLevelEditor(appState) {
  canvas = document.getElementById('level-canvas');
  ctx = canvas.getContext('2d');
  resizeCanvasToFit();

  minimapCanvas = document.getElementById('minimap-canvas');
  minimapCtx = minimapCanvas.getContext('2d');

  gameData = appState.gameData;
  tileset = appState.tileset;
  selectedTile = appState.selectedTile || 1;
  vgaTileset = appState.vgaTileset;
  vgaDecompressed = appState.vgaDecompressed;
  vgaPalette = appState.vgaPalette;

  // Pre-render tiles to offscreen canvases (VGA when available, EGA fallback)
  tileCanvasCache = [];
  if (vgaTileset && vgaDecompressed && vgaPalette) {
    // Build VGA tile canvases for level tiles (0..52)
    for (let i = 0; i < Math.min(LEVEL_TILE_COUNT, vgaTileset.length); i++) {
      tileCanvasCache.push(vgaTileToCanvas(i, true));
    }
    // Build sprite canvases for player (Dave standing = VGA 56) and monsters
    spriteCanvasCache[56] = vgaTileToCanvas(56, false); // Dave standing
    // Monster first-frames: 8 types starting at VGA 89, 4 frames each
    for (let type = 0; type < 8; type++) {
      const idx = 89 + type * 4;
      if (idx < vgaTileset.length) {
        spriteCanvasCache[idx] = vgaTileToCanvas(idx, false);
      }
    }
  } else {
    // Fallback to EGA tiles
    for (let i = 0; i < tileset.length; i++) {
      tileCanvasCache.push(tileToCanvasOpaque(tileset[i]));
    }
  }

  // Set up event handlers
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('mouseleave', onMouseUp);
  canvas.addEventListener('contextmenu', onContextMenu);

  // Keyboard shortcuts
  document.addEventListener('keydown', onKeyDown);

  // Grid/viewport toggles
  document.getElementById('show-grid').addEventListener('change', (e) => {
    showGrid = e.target.checked;
    render();
  });
  document.getElementById('show-viewport').addEventListener('change', (e) => {
    showViewport = e.target.checked;
    render();
  });

  // Undo/Redo buttons
  document.getElementById('btn-undo').addEventListener('click', undo);
  document.getElementById('btn-redo').addEventListener('click', redo);

  // Minimap click for scrolling
  const minimapContainer = document.getElementById('minimap-container');
  minimapContainer.addEventListener('click', onMinimapClick);

  // Scroll sync for minimap viewport indicator
  const container = document.getElementById('canvas-container');
  container.addEventListener('scroll', updateMinimapViewport);

  // Handle window resize
  window.addEventListener('resize', resizeCanvasToFit);

  // Watch container size changes (layout settling after init)
  const resizeObs = new ResizeObserver(() => resizeCanvasToFit());
  resizeObs.observe(document.getElementById('canvas-container'));

  loadLevel(0);
}

export function loadLevel(levelIndex) {
  if (!gameData) return;
  currentLevel = gameData.levels[levelIndex];
  undoStack = [];
  redoStack = [];
  render();
  renderMinimap();
  // Reset scroll to top-left
  const container = document.getElementById('canvas-container');
  container.scrollTop = 0;
  container.scrollLeft = 0;
  updateMinimapViewport();
}

export function setSelectedTile(tileIdx) {
  selectedTile = tileIdx;
}

export function setTool(tool) {
  currentTool = tool;
  canvas.style.cursor = tool === 'paint' || tool === 'erase' || tool === 'fill'
    ? 'crosshair' : 'pointer';
}

export function setCursorCallback(cb) {
  onCursorMove = cb;
}

function pushUndo() {
  undoStack.push(new Uint8Array(currentLevel.tileMap));
  if (undoStack.length > 50) undoStack.shift();
  redoStack = [];
}

export function undo() {
  if (undoStack.length === 0) return;
  redoStack.push(new Uint8Array(currentLevel.tileMap));
  currentLevel.tileMap = undoStack.pop();
  render();
  renderMinimap();
}

export function redo() {
  if (redoStack.length === 0) return;
  undoStack.push(new Uint8Array(currentLevel.tileMap));
  currentLevel.tileMap = redoStack.pop();
  render();
  renderMinimap();
}

function resizeCanvasToFit() {
  if (!canvas) return;
  const container = document.getElementById('canvas-container');
  const containerHeight = container.clientHeight;
  if (containerHeight > 0) {
    // Calculate scale so 10 tile rows exactly fill the container height
    const tileDisplay = Math.floor(containerHeight / LEVEL_HEIGHT);
    displayScale = tileDisplay / TILE_SIZE;
    canvas.width = Math.round(LEVEL_WIDTH * TILE_SIZE * displayScale);
    canvas.height = tileDisplay * LEVEL_HEIGHT;
    canvas.style.width = '';
    canvas.style.height = '';
    if (currentLevel) {
      render();
      renderMinimap();
    }
  }
}

function getTileCoords(e) {
  const rect = canvas.getBoundingClientRect();
  const tileDisplay = Math.round(TILE_SIZE * displayScale);
  const x = Math.floor((e.clientX - rect.left) / tileDisplay);
  const y = Math.floor((e.clientY - rect.top) / tileDisplay);
  return { col: Math.max(0, Math.min(x, LEVEL_WIDTH - 1)),
           row: Math.max(0, Math.min(y, LEVEL_HEIGHT - 1)) };
}

function onMouseDown(e) {
  if (e.button === 2) return; // handled by contextmenu
  const { col, row } = getTileCoords(e);

  if (currentTool === 'paint' || currentTool === 'erase') {
    pushUndo();
    isPainting = true;
    paintTile(col, row);
  } else if (currentTool === 'fill') {
    pushUndo();
    floodFill(col, row, selectedTile);
    render();
    renderMinimap();
  } else if (currentTool === 'player') {
    // Handled by player-editor
    const event = new CustomEvent('placePlayer', { detail: { col, row } });
    canvas.dispatchEvent(event);
  } else if (currentTool === 'monster') {
    const event = new CustomEvent('placeMonster', { detail: { col, row } });
    canvas.dispatchEvent(event);
  }
}

function onMouseMove(e) {
  const { col, row } = getTileCoords(e);

  if (onCursorMove) {
    onCursorMove(col, row, getTile(currentLevel, col, row));
  }

  if (isPainting) {
    paintTile(col, row);
  }
}

function onMouseUp() {
  isPainting = false;
}

function onContextMenu(e) {
  e.preventDefault();
  const { col, row } = getTileCoords(e);
  const tile = getTile(currentLevel, col, row);
  // Eyedropper
  selectedTile = tile;
  const event = new CustomEvent('eyedropper', { detail: { tileIdx: tile } });
  canvas.dispatchEvent(event);
}

function onKeyDown(e) {
  if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
  if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo(); }
  if (e.key === 'p') setTool('paint');
  if (e.key === 'e') setTool('erase');
  if (e.key === 'f') setTool('fill');
  if (e.key === 's' && !e.ctrlKey) setTool('player');
  if (e.key === 'm') setTool('monster');
}

function paintTile(col, row) {
  const tileIdx = currentTool === 'erase' ? 0 : selectedTile;
  setTile(currentLevel, col, row, tileIdx);
  // Render just the changed tile for performance
  renderTileAt(col, row);
  renderMinimapTile(col, row);
}

function floodFill(startCol, startRow, fillTile) {
  const targetTile = getTile(currentLevel, startCol, startRow);
  if (targetTile === fillTile) return;

  const stack = [[startCol, startRow]];
  const visited = new Set();

  while (stack.length > 0) {
    const [col, row] = stack.pop();
    const key = row * LEVEL_WIDTH + col;
    if (visited.has(key)) continue;
    if (col < 0 || col >= LEVEL_WIDTH || row < 0 || row >= LEVEL_HEIGHT) continue;
    if (getTile(currentLevel, col, row) !== targetTile) continue;

    visited.add(key);
    setTile(currentLevel, col, row, fillTile);

    stack.push([col + 1, row]);
    stack.push([col - 1, row]);
    stack.push([col, row + 1]);
    stack.push([col, row - 1]);
  }
}

// Convenience wrapper for the shared VGA tile-to-canvas utility
function vgaTileToCanvas(tileIndex, opaque) {
  return _vgaTileToCanvas(vgaTileset, vgaDecompressed, vgaPalette, tileIndex, opaque);
}

// Parse level path data into array of {dx, dy} deltas (signed bytes).
// Path terminates at 0xEA 0xEA (-22, -22).
function parsePathDeltas(pathData) {
  const deltas = [];
  for (let i = 0; i < pathData.length - 1; i += 2) {
    const rawDx = pathData[i];
    const rawDy = pathData[i + 1];
    // Terminator check (0xEA = 234 unsigned = -22 signed)
    if (rawDx === 0xEA && rawDy === 0xEA) break;
    // Convert unsigned bytes to signed (-128 to 127)
    const dx = rawDx > 127 ? rawDx - 256 : rawDx;
    const dy = rawDy > 127 ? rawDy - 256 : rawDy;
    deltas.push({ dx, dy });
  }
  return deltas;
}

// Draw a monster's patrol path as a dotted trail.
// Traces the full closed-loop path from the monster's position.
function drawMonsterPath(ctx, monster, pathDeltas, color, scale) {
  if (pathDeltas.length === 0) return;
  const pairStart = Math.floor((monster.pathOffset || 0) / 2);
  const totalPairs = pathDeltas.length;

  // Trace path in pixel coordinates, starting from monster pos
  // Y is adjusted -TILE_SIZE to match the sprite display offset
  let cx = monster.x + TILE_SIZE / 2; // center of sprite
  let cy = monster.y - TILE_SIZE + TILE_SIZE / 2; // center, adjusted up 1 tile
  const points = [{ x: cx, y: cy }];

  for (let step = 0; step < totalPairs; step++) {
    const idx = (pairStart + step) % totalPairs;
    cx += pathDeltas[idx].dx;
    cy += pathDeltas[idx].dy;
    points.push({ x: cx, y: cy });
  }

  // Draw path as semi-transparent dotted line
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = Math.max(1, scale * 0.8);
  ctx.setLineDash([scale * 2, scale * 2]);
  ctx.beginPath();
  ctx.moveTo(points[0].x * scale, points[0].y * scale);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x * scale, points[i].y * scale);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1.0;
  ctx.restore();
}

export function render() {
  if (!currentLevel || !tileset) return;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Fill background black
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw tiles
  for (let row = 0; row < LEVEL_HEIGHT; row++) {
    for (let col = 0; col < LEVEL_WIDTH; col++) {
      const tileIdx = getTile(currentLevel, col, row);
      if (tileIdx > 0 && tileIdx < LEVEL_TILE_COUNT && tileIdx < tileCanvasCache.length) {
        ctx.drawImage(
          tileCanvasCache[tileIdx],
          col * TILE_SIZE * displayScale,
          row * TILE_SIZE * displayScale,
          TILE_SIZE * displayScale,
          TILE_SIZE * displayScale
        );
      }
    }
  }

  // Draw grid
  if (showGrid) {
    ctx.strokeStyle = 'rgba(100, 100, 100, 0.3)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= LEVEL_WIDTH; x++) {
      ctx.beginPath();
      ctx.moveTo(x * TILE_SIZE * displayScale + 0.5, 0);
      ctx.lineTo(x * TILE_SIZE * displayScale + 0.5, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y <= LEVEL_HEIGHT; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * TILE_SIZE * displayScale + 0.5);
      ctx.lineTo(canvas.width, y * TILE_SIZE * displayScale + 0.5);
      ctx.stroke();
    }
  }

  // Draw viewport indicator
  if (showViewport) {
    ctx.strokeStyle = 'rgba(85, 255, 255, 0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, VIEWPORT_WIDTH * TILE_SIZE * displayScale, VIEWPORT_HEIGHT * TILE_SIZE * displayScale);
  }

  // Draw player start (Y offset: game stores foot-level Y; display 1 tile up)
  if (gameData) {
    const levelIdx = gameData.levels.indexOf(currentLevel);
    if (levelIdx >= 0) {
      const start = gameData.playerStarts[levelIdx];
      const px = start.x / TILE_SIZE;
      const py = (start.y / TILE_SIZE) - 1; // display one tile up (sprite head position)
      const drawX = px * TILE_SIZE * displayScale;
      const drawY = py * TILE_SIZE * displayScale;
      const size = TILE_SIZE * displayScale;

      // Draw Dave sprite if available, otherwise fallback rectangle
      const daveSprite = spriteCanvasCache[56];
      if (daveSprite) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(daveSprite, drawX, drawY, size, size);
      } else {
        ctx.fillStyle = 'rgba(85, 255, 85, 0.3)';
        ctx.fillRect(drawX, drawY, size, size);
        ctx.fillStyle = '#55ff55';
        ctx.font = '10px monospace';
        ctx.fillText('P', drawX + 4, drawY + 12);
      }
      // Green border
      ctx.strokeStyle = '#55ff55';
      ctx.lineWidth = 2;
      ctx.strokeRect(drawX, drawY, size, size);
    }
  }

  // Draw monster positions + patrol paths
  if (gameData) {
    const levelIdx = gameData.levels.indexOf(currentLevel);
    if (levelIdx >= 0) {
      const monsters = gameData.monsters[levelIdx];
      // Monster VGA sprite: levels 1-2 use Spider (89) via EXE clamp patch
      const monsterVGABase = levelIdx >= 2 ? (levelIdx - 2) * 4 + 89 : 89;
      const monSprite = spriteCanvasCache[monsterVGABase];
      // Parse level path data for patrol trail drawing
      const pathDeltas = parsePathDeltas(currentLevel.pathData);
      // Per-monster colors for path trails
      const trailColors = ['#ff5555', '#ffaa00', '#55ff55', '#55aaff'];

      for (let m = 0; m < monsters.length; m++) {
        if (monsters[m].enabled) {
          const mon = monsters[m];
          const mx = mon.x / TILE_SIZE;
          const my = (mon.y / TILE_SIZE) - 1; // display one tile up
          const drawX = mx * TILE_SIZE * displayScale;
          const drawY = my * TILE_SIZE * displayScale;
          const size = TILE_SIZE * displayScale;
          const color = trailColors[m % trailColors.length];

          // Draw patrol path trail
          if (pathDeltas.length > 0) {
            drawMonsterPath(ctx, mon, pathDeltas, color, displayScale);
          }

          // Draw monster sprite
          if (monSprite) {
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(monSprite, drawX, drawY, size, size);
          } else {
            ctx.fillStyle = 'rgba(255, 85, 85, 0.3)';
            ctx.fillRect(drawX, drawY, size, size);
          }
          // Colored border + label
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.strokeRect(drawX, drawY, size, size);
          ctx.fillStyle = color;
          ctx.font = `${Math.max(9, Math.round(size * 0.2))}px monospace`;
          ctx.fillText(`M${m + 1}`, drawX + 2, drawY + Math.round(size * 0.25));
        }
      }
    }
  }
}

function renderTileAt(col, row) {
  const x = col * TILE_SIZE * displayScale;
  const y = row * TILE_SIZE * displayScale;
  const size = TILE_SIZE * displayScale;

  // Clear and redraw single tile
  ctx.fillStyle = '#000';
  ctx.fillRect(x, y, size, size);

  const tileIdx = getTile(currentLevel, col, row);
  if (tileIdx > 0 && tileIdx < LEVEL_TILE_COUNT && tileIdx < tileCanvasCache.length) {
    ctx.drawImage(tileCanvasCache[tileIdx], x, y, size, size);
  }

  // Redraw grid lines around this tile
  if (showGrid) {
    ctx.strokeStyle = 'rgba(100, 100, 100, 0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, size, size);
  }
}

function renderMinimap() {
  if (!currentLevel || !minimapCanvas) return;
  const container = document.getElementById('minimap-container');
  const w = container.clientWidth;
  const h = container.clientHeight;
  minimapCanvas.width = w;
  minimapCanvas.height = h;

  const tileW = w / LEVEL_WIDTH;
  const tileH = h / LEVEL_HEIGHT;

  minimapCtx.fillStyle = '#000';
  minimapCtx.fillRect(0, 0, w, h);

  for (let row = 0; row < LEVEL_HEIGHT; row++) {
    for (let col = 0; col < LEVEL_WIDTH; col++) {
      const tileIdx = getTile(currentLevel, col, row);
      if (tileIdx > 0 && tileIdx < LEVEL_TILE_COUNT && tileIdx < tileCanvasCache.length) {
        minimapCtx.drawImage(
          tileCanvasCache[tileIdx],
          col * tileW, row * tileH, tileW + 1, tileH + 1
        );
      }
    }
  }
}

function renderMinimapTile(col, row) {
  if (!minimapCanvas) return;
  const container = document.getElementById('minimap-container');
  const w = container.clientWidth;
  const h = container.clientHeight;
  const tileW = w / LEVEL_WIDTH;
  const tileH = h / LEVEL_HEIGHT;

  const tileIdx = getTile(currentLevel, col, row);
  if (tileIdx === 0) {
    minimapCtx.fillStyle = '#000';
    minimapCtx.fillRect(col * tileW, row * tileH, tileW + 1, tileH + 1);
  } else if (tileIdx < LEVEL_TILE_COUNT && tileIdx < tileCanvasCache.length) {
    minimapCtx.drawImage(
      tileCanvasCache[tileIdx],
      col * tileW, row * tileH, tileW + 1, tileH + 1
    );
  }
}

function updateMinimapViewport() {
  const container = document.getElementById('canvas-container');
  const indicator = document.getElementById('minimap-viewport');
  const minimapContainer = document.getElementById('minimap-container');

  if (!container || !indicator || !minimapContainer) return;

  const scrollRatio = container.scrollLeft / (canvas.width || 1);
  const visibleRatio = container.clientWidth / (canvas.width || 1);
  const minimapW = minimapContainer.clientWidth;

  indicator.style.left = (scrollRatio * minimapW) + 'px';
  indicator.style.width = (visibleRatio * minimapW) + 'px';
}

function onMinimapClick(e) {
  const container = document.getElementById('canvas-container');
  const minimapContainer = document.getElementById('minimap-container');
  const rect = minimapContainer.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const ratio = clickX / minimapContainer.clientWidth;

  container.scrollLeft = ratio * canvas.width - container.clientWidth / 2;
}

export function getCanvas() { return canvas; }
