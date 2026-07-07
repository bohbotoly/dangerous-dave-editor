// Title Screen Editor - 10x7 tile grid
import { TITLE_WIDTH, TITLE_HEIGHT, TILE_SIZE } from './constants.js';
import { tileToCanvasOpaque } from './tileset-parser.js';

const SCALE = 3;
let canvas, ctx;
let gameData = null;
let tileset = null;
let tileCanvasCache = [];
let selectedTile = 1;
let isPainting = false;

export function initTitleEditor(appState) {
  canvas = document.getElementById('title-canvas');
  ctx = canvas.getContext('2d');
  canvas.width = TITLE_WIDTH * TILE_SIZE * SCALE;
  canvas.height = TITLE_HEIGHT * TILE_SIZE * SCALE;

  gameData = appState.gameData;
  tileset = appState.tileset;

  tileCanvasCache = [];
  for (let i = 0; i < tileset.length; i++) {
    tileCanvasCache.push(tileToCanvasOpaque(tileset[i]));
  }

  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', () => isPainting = false);
  canvas.addEventListener('mouseleave', () => isPainting = false);
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const { col, row } = getCoords(e);
    selectedTile = getTitleTile(col, row);
  });

  render();
}

export function setSelectedTile(tileIdx) {
  selectedTile = tileIdx;
}

function getCoords(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    col: Math.min(Math.floor((e.clientX - rect.left) / (TILE_SIZE * SCALE)), TITLE_WIDTH - 1),
    row: Math.min(Math.floor((e.clientY - rect.top) / (TILE_SIZE * SCALE)), TITLE_HEIGHT - 1),
  };
}

function getTitleTile(col, row) {
  return gameData.titleScreen[row * TITLE_WIDTH + col];
}

function setTitleTile(col, row, tileIdx) {
  gameData.titleScreen[row * TITLE_WIDTH + col] = tileIdx;
}

function onMouseDown(e) {
  if (e.button === 2) return;
  isPainting = true;
  const { col, row } = getCoords(e);
  setTitleTile(col, row, selectedTile);
  render();
}

function onMouseMove(e) {
  if (!isPainting) return;
  const { col, row } = getCoords(e);
  setTitleTile(col, row, selectedTile);
  render();
}

function render() {
  if (!gameData || !tileset) return;

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let row = 0; row < TITLE_HEIGHT; row++) {
    for (let col = 0; col < TITLE_WIDTH; col++) {
      const tileIdx = getTitleTile(col, row);
      if (tileIdx > 0 && tileIdx < tileCanvasCache.length) {
        ctx.drawImage(
          tileCanvasCache[tileIdx],
          col * TILE_SIZE * SCALE,
          row * TILE_SIZE * SCALE,
          TILE_SIZE * SCALE,
          TILE_SIZE * SCALE
        );
      }
    }
  }

  // Grid
  ctx.strokeStyle = 'rgba(100, 100, 100, 0.3)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= TITLE_WIDTH; x++) {
    ctx.beginPath();
    ctx.moveTo(x * TILE_SIZE * SCALE + 0.5, 0);
    ctx.lineTo(x * TILE_SIZE * SCALE + 0.5, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= TITLE_HEIGHT; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * TILE_SIZE * SCALE + 0.5);
    ctx.lineTo(canvas.width, y * TILE_SIZE * SCALE + 0.5);
    ctx.stroke();
  }
}
