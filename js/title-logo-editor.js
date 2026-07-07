// Title Logo Sprite Editor - Edit flaming "Dangerous Dave" logo sprites
// Edits are synced to both EGA (EGADAVE.DAV) and VGA (EXE) data.
// Tiles with VGA counterparts show BOTH EGA + VGA canvases side-by-side.
// Each sprite card has its own toolbar (colors, brush, undo/redo).
import { EGA_PALETTE } from './constants.js';
import { encodeEGATile } from './tileset-parser.js';
import { encodeVGATile, getVGAPalette } from './vga-parser.js';

let appStateRef = null;
let tileset = null;
let davData = null;
let vgaTileset = null;
let vgaDecompressed = null;
let vgaPalette = null; // 256-entry VGA palette [[r,g,b], ...]
let logoZoom = 3;

// Global painting state
let selectedEGAColor = 14; // EGA palette index (0-15)
let selectedVGAColor = 14; // VGA palette index (0-255)
let brushSize = 1;
let isPainting = false;
let paintingCanvas = null;
let paintingCardKey = null; // "ega:INDEX" or "vga:INDEX"

const VGA_TRANSPARENT = 230;
const MAX_UNDO = 60;

// Sprite groups
const SPRITE_GROUPS = [
  {
    heading: 'Title Logo Sprites',
    sprites: [
      { tileIdx: 378, label: '"GO THRU THE DOOR!" Banner' },
      { tileIdx: 387, label: 'Flaming Logo Frame 1' },
      { tileIdx: 388, label: 'Flaming Logo Frame 2' },
      { tileIdx: 389, label: 'Flaming Logo Frame 3' },
      { tileIdx: 390, label: 'Flaming Logo Frame 4' },
      { tileIdx: 379, label: '"WARP" Text' },
      { tileIdx: 380, label: '"ZONE" Text' },
      { tileIdx: 381, label: 'Gold Border Frame' },
    ],
  },
  {
    heading: 'HUD Sprites',
    sprites: [
      { tileIdx: 377, label: '"SCORE:" Label' },
      { tileIdx: 376, label: '"LEVEL" Label' },
      { tileIdx: 375, label: '"DAVES:" Label' },
      { tileIdx: 373, label: '"JETPACK" Label' },
      { tileIdx: 374, label: '"GUN" Label + Icon' },
      { tileIdx: 386, label: 'Dave Face (Lives)' },
    ],
  },
  {
    heading: 'Score Digits (EGA only)',
    compact: true,
    sprites: [
      { tileIdx: 391, label: '0' },
      { tileIdx: 392, label: '1' },
      { tileIdx: 393, label: '2' },
      { tileIdx: 394, label: '3' },
      { tileIdx: 395, label: '4' },
      { tileIdx: 396, label: '5' },
      { tileIdx: 397, label: '6' },
      { tileIdx: 398, label: '7' },
      { tileIdx: 399, label: '8' },
      { tileIdx: 400, label: '9' },
    ],
  },
];

// EGA -> VGA tile index mapping
const EGA_TO_VGA_LOGO = {
  378: 138, 379: 139, 380: 140, 381: 141,
  387: 144, 388: 145, 389: 146, 390: 147,
  373: 133, 374: 134, 375: 135, 376: 136, 377: 137,
  386: 143,
};

// Per-canvas state keyed by "ega:INDEX" or "vga:INDEX"
const cardState = new Map();

// Separate picker arrays for EGA vs VGA color sync
const allEGAPickers = [];
const allVGAPickers = [];
const allBrushGroups = [];

// ===== Init =====

export function initLogoEditor(appState) {
  appStateRef = appState;
  tileset = appState.tileset;
  davData = appState.davData;
  vgaTileset = appState.vgaTileset;
  vgaDecompressed = appState.vgaDecompressed;
  vgaPalette = appState.vgaPalette || getVGAPalette();

  if (!tileset || !davData) return;

  document.getElementById('logo-zoom').addEventListener('input', (e) => {
    logoZoom = parseInt(e.target.value);
    renderAllSprites();
  });

  document.addEventListener('mouseup', () => {
    if (isPainting) {
      isPainting = false;
      if (paintingCardKey) flushPaint(paintingCardKey);
      paintingCanvas = null;
      paintingCardKey = null;
    }
  });

  document.addEventListener('keydown', (e) => {
    const titleTab = document.querySelector('.tab-content[data-tab="title"]');
    if (!titleTab || !titleTab.classList.contains('active')) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      if (paintingCardKey) { performUndo(paintingCardKey); }
      else { for (const [k, cs] of cardState) { if (cs.undoStack.length > 0) { performUndo(k); break; } } }
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      if (paintingCardKey) { performRedo(paintingCardKey); }
      else { for (const [k, cs] of cardState) { if (cs.redoStack.length > 0) { performRedo(k); break; } } }
    }
  });

  renderAllSprites();
}

// ===== VGA ImageData builder =====

function buildVGAImageData(vgaTile) {
  const w = vgaTile.width, h = vgaTile.height;
  const pal = vgaPalette || EGA_PALETTE;
  const imageData = new ImageData(w, h);
  const paletteIndices = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const colorIdx = vgaDecompressed[vgaTile.dataStart + y * w + x];
      const pixOff = (y * w + x) * 4;
      paletteIndices[y * w + x] = colorIdx;
      if (colorIdx === VGA_TRANSPARENT) {
        imageData.data[pixOff + 3] = 0;
      } else if (colorIdx < pal.length) {
        const c = pal[colorIdx];
        imageData.data[pixOff] = c[0];
        imageData.data[pixOff + 1] = c[1];
        imageData.data[pixOff + 2] = c[2];
        imageData.data[pixOff + 3] = 255;
      } else {
        imageData.data[pixOff] = 64; imageData.data[pixOff + 1] = 64;
        imageData.data[pixOff + 2] = 64; imageData.data[pixOff + 3] = 255;
      }
    }
  }
  return { imageData, paletteIndices };
}

// Collect unique VGA palette indices used in a VGA tile
function getUsedVGAColors(vgaTile) {
  const used = new Set();
  const w = vgaTile.width, h = vgaTile.height;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = vgaDecompressed[vgaTile.dataStart + y * w + x];
      if (idx !== VGA_TRANSPARENT) used.add(idx);
    }
  }
  return [...used].sort((a, b) => a - b);
}

// ===== Color picker sync =====

function syncEGAPickers() {
  for (const picker of allEGAPickers) {
    picker.querySelectorAll('.color-swatch').forEach(s => {
      s.classList.toggle('selected', parseInt(s.dataset.idx) === selectedEGAColor);
    });
  }
}

function syncVGAPickers() {
  for (const picker of allVGAPickers) {
    picker.querySelectorAll('.color-swatch').forEach(s => {
      s.classList.toggle('selected', parseInt(s.dataset.idx) === selectedVGAColor);
    });
  }
}

function syncBrushButtons() {
  for (const group of allBrushGroups) {
    group.querySelectorAll('button').forEach(b => {
      b.style.borderColor = parseInt(b.dataset.size) === brushSize ? '#55ff55' : '#0f3460';
    });
  }
}

// ===== Toolbar builders =====

function buildEGAToolbar(cardKey) {
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:4px 0';

  // EGA color picker (16 colors)
  const picker = document.createElement('div');
  picker.style.cssText = 'display:flex;gap:1px;flex-wrap:wrap';
  for (let i = 0; i < 16; i++) {
    const swatch = makeSwatch(EGA_PALETTE[i], i, i === selectedEGAColor);
    swatch.addEventListener('click', () => { selectedEGAColor = i; syncEGAPickers(); });
    picker.appendChild(swatch);
  }
  allEGAPickers.push(picker);
  bar.appendChild(picker);
  bar.appendChild(makeSep());

  // Brush + undo/redo
  const { brushGroup, undoBtn, redoBtn } = buildBrushAndUndo(cardKey);
  bar.appendChild(brushGroup);
  bar.appendChild(makeSep());
  bar.appendChild(undoBtn);
  bar.appendChild(redoBtn);

  const hint = document.createElement('span');
  hint.style.cssText = 'font-size:9px;color:#555;margin-left:4px';
  hint.textContent = 'Right-click = eyedropper';
  bar.appendChild(hint);

  return { bar, undoBtn, redoBtn };
}

function buildVGAToolbar(cardKey, vgaTile) {
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:4px 0';

  const pal = vgaPalette || EGA_PALETTE;

  // VGA color picker: show first 16 palette colors + unique extras from tile
  const picker = document.createElement('div');
  picker.style.cssText = 'display:flex;gap:1px;flex-wrap:wrap;max-width:360px';

  // First 16 VGA palette colors
  for (let i = 0; i < 16; i++) {
    const swatch = makeSwatch(pal[i], i, i === selectedVGAColor);
    swatch.addEventListener('click', () => { selectedVGAColor = i; syncVGAPickers(); });
    picker.appendChild(swatch);
  }

  // Extra unique colors from the tile (indices > 15)
  if (vgaTile) {
    const usedColors = getUsedVGAColors(vgaTile);
    const extras = usedColors.filter(idx => idx >= 16);
    if (extras.length > 0) {
      // Small separator dot
      const sep = document.createElement('div');
      sep.style.cssText = 'width:2px;height:14px;background:#444;margin:0 1px';
      picker.appendChild(sep);
      for (const idx of extras) {
        if (idx >= pal.length) continue;
        const swatch = makeSwatch(pal[idx], idx, idx === selectedVGAColor);
        swatch.title = `VGA #${idx}`;
        swatch.addEventListener('click', () => { selectedVGAColor = idx; syncVGAPickers(); });
        picker.appendChild(swatch);
      }
    }
  }
  allVGAPickers.push(picker);
  bar.appendChild(picker);
  bar.appendChild(makeSep());

  const { brushGroup, undoBtn, redoBtn } = buildBrushAndUndo(cardKey);
  bar.appendChild(brushGroup);
  bar.appendChild(makeSep());
  bar.appendChild(undoBtn);
  bar.appendChild(redoBtn);

  const hint = document.createElement('span');
  hint.style.cssText = 'font-size:9px;color:#555;margin-left:4px';
  hint.textContent = 'Right-click = eyedropper';
  bar.appendChild(hint);

  return { bar, undoBtn, redoBtn };
}

function buildBrushAndUndo(cardKey) {
  const brushGroup = document.createElement('div');
  brushGroup.style.cssText = 'display:flex;align-items:center;gap:2px';
  const brushLabel = document.createElement('span');
  brushLabel.style.cssText = 'font-size:10px;color:#777';
  brushLabel.textContent = 'Brush:';
  brushGroup.appendChild(brushLabel);
  for (const size of [1, 2, 3, 5, 8]) {
    const btn = document.createElement('button');
    btn.textContent = `${size}`;
    btn.dataset.size = size;
    btn.style.cssText = 'font-size:9px;padding:1px 4px;cursor:pointer;background:#0d1b2a;color:#e0e0e0;border:1px solid #0f3460;border-radius:2px;min-width:18px';
    if (size === brushSize) btn.style.borderColor = '#55ff55';
    btn.addEventListener('click', () => { brushSize = size; syncBrushButtons(); });
    brushGroup.appendChild(btn);
  }
  allBrushGroups.push(brushGroup);

  const undoBtn = document.createElement('button');
  undoBtn.textContent = 'Undo'; undoBtn.title = 'Undo (Ctrl+Z)'; undoBtn.disabled = true;
  undoBtn.style.cssText = 'font-size:9px;padding:1px 6px;cursor:pointer;background:#0d1b2a;color:#e0e0e0;border:1px solid #0f3460;border-radius:2px';
  undoBtn.addEventListener('click', () => performUndo(cardKey));

  const redoBtn = document.createElement('button');
  redoBtn.textContent = 'Redo'; redoBtn.title = 'Redo (Ctrl+Y)'; redoBtn.disabled = true;
  redoBtn.style.cssText = 'font-size:9px;padding:1px 6px;cursor:pointer;background:#0d1b2a;color:#e0e0e0;border:1px solid #0f3460;border-radius:2px';
  redoBtn.addEventListener('click', () => performRedo(cardKey));

  return { brushGroup, undoBtn, redoBtn };
}

function makeSwatch(rgb, idx, isSelected) {
  const swatch = document.createElement('div');
  swatch.className = 'color-swatch';
  swatch.dataset.idx = idx;
  if (isSelected) swatch.classList.add('selected');
  swatch.style.cssText = `width:14px;height:14px;border-radius:2px;cursor:pointer;border:1px solid #333;box-sizing:border-box;background:rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  swatch.title = `#${idx}`;
  return swatch;
}

function makeSep() {
  const sep = document.createElement('div');
  sep.style.cssText = 'width:1px;height:16px;background:#0f3460';
  return sep;
}

// ===== Undo / Redo =====

function snapshotCard(key) {
  const cs = cardState.get(key);
  if (!cs) return null;
  const snap = { key, data: new Uint8ClampedArray(cs.imageData.data) };
  if (cs.paletteIndices) snap.paletteIndices = new Uint8Array(cs.paletteIndices);
  return snap;
}

function restoreSnapshot(snapshot) {
  const cs = cardState.get(snapshot.key);
  if (!cs) return;
  cs.imageData.data.set(snapshot.data);
  if (snapshot.paletteIndices && cs.paletteIndices) {
    cs.paletteIndices.set(snapshot.paletteIndices);
  }
  flushPaint(snapshot.key);
  renderCanvasFromImageData(cs.canvas, cs.imageData, cs.width, cs.height);
  // If EGA restored, refresh VGA companion
  if (snapshot.key.startsWith('ega:')) {
    const egaIdx = parseInt(snapshot.key.slice(4));
    const vgaCs = cardState.get('vga:' + egaIdx);
    if (vgaCs) {
      const vgaIdx = EGA_TO_VGA_LOGO[egaIdx];
      const vgaTile = vgaTileset?.[vgaIdx];
      if (vgaTile) {
        const vgaBuild = buildVGAImageData(vgaTile);
        vgaCs.imageData = vgaBuild.imageData;
        vgaCs.paletteIndices = vgaBuild.paletteIndices;
        renderCanvasFromImageData(vgaCs.canvas, vgaCs.imageData, vgaCs.width, vgaCs.height);
      }
    }
  }
}

function performUndo(key) {
  const cs = cardState.get(key);
  if (!cs || cs.undoStack.length === 0) return;
  cs.redoStack.push(snapshotCard(key));
  restoreSnapshot(cs.undoStack.pop());
  updateUndoRedoButtons(key);
}

function performRedo(key) {
  const cs = cardState.get(key);
  if (!cs || cs.redoStack.length === 0) return;
  cs.undoStack.push(snapshotCard(key));
  restoreSnapshot(cs.redoStack.pop());
  updateUndoRedoButtons(key);
}

function updateUndoRedoButtons(key) {
  const cs = cardState.get(key);
  if (!cs) return;
  cs.undoBtn.disabled = cs.undoStack.length === 0;
  cs.redoBtn.disabled = cs.redoStack.length === 0;
}

// ===== Rendering =====

function renderAllSprites() {
  const container = document.getElementById('logo-sprites-container');
  if (!container) return;
  container.innerHTML = '';

  const prevStacks = new Map();
  for (const [key, cs] of cardState) {
    prevStacks.set(key, { undoStack: cs.undoStack, redoStack: cs.redoStack });
  }
  cardState.clear();
  allEGAPickers.length = 0;
  allVGAPickers.length = 0;
  allBrushGroups.length = 0;

  for (const group of SPRITE_GROUPS) {
    const heading = document.createElement('h4');
    heading.style.cssText = 'color:#55ffff;margin:8px 0 4px;font-size:13px';
    heading.textContent = group.heading;
    container.appendChild(heading);

    // Compact mode (digits)
    if (group.compact) {
      renderCompactGroup(container, group, prevStacks);
      continue;
    }

    // Normal mode
    for (const def of group.sprites) {
      const tile = tileset[def.tileIdx];
      if (!tile) continue;
      renderNormalCard(container, def, tile, prevStacks);
    }
  }
}

function renderCompactGroup(container, group, prevStacks) {
  const section = document.createElement('div');
  section.style.cssText = 'background:#0a1628;border:1px solid #0f3460;border-radius:4px;padding:6px;display:flex;flex-direction:column;gap:4px';

  // Shared toolbar
  const sharedBar = document.createElement('div');
  sharedBar.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:2px 0';
  const picker = document.createElement('div');
  picker.style.cssText = 'display:flex;gap:1px;flex-wrap:wrap';
  for (let i = 0; i < 16; i++) {
    const swatch = makeSwatch(EGA_PALETTE[i], i, i === selectedEGAColor);
    swatch.addEventListener('click', () => { selectedEGAColor = i; syncEGAPickers(); });
    picker.appendChild(swatch);
  }
  allEGAPickers.push(picker);
  sharedBar.appendChild(picker);
  sharedBar.appendChild(makeSep());

  const brushGroup = document.createElement('div');
  brushGroup.style.cssText = 'display:flex;align-items:center;gap:2px';
  const bl = document.createElement('span');
  bl.style.cssText = 'font-size:10px;color:#777'; bl.textContent = 'Brush:';
  brushGroup.appendChild(bl);
  for (const size of [1, 2, 3]) {
    const btn = document.createElement('button');
    btn.textContent = `${size}`; btn.dataset.size = size;
    btn.style.cssText = 'font-size:9px;padding:1px 4px;cursor:pointer;background:#0d1b2a;color:#e0e0e0;border:1px solid #0f3460;border-radius:2px;min-width:18px';
    if (size === brushSize) btn.style.borderColor = '#55ff55';
    btn.addEventListener('click', () => { brushSize = size; syncBrushButtons(); });
    brushGroup.appendChild(btn);
  }
  allBrushGroups.push(brushGroup);
  sharedBar.appendChild(brushGroup);
  const hint = document.createElement('span');
  hint.style.cssText = 'font-size:9px;color:#555;margin-left:4px';
  hint.textContent = 'Right-click = eyedropper';
  sharedBar.appendChild(hint);
  section.appendChild(sharedBar);

  // Digit row
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;align-items:flex-end';
  for (const def of group.sprites) {
    const tile = tileset[def.tileIdx];
    if (!tile) continue;
    const egaKey = 'ega:' + def.tileIdx;
    const miniCard = document.createElement('div');
    miniCard.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:1px';
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'image-rendering:pixelated;cursor:crosshair;border:1px solid #0f3460;max-width:fit-content';
    renderCanvasFromImageData(canvas, tile.imageData, tile.width, tile.height);
    miniCard.appendChild(canvas);
    const lbl = document.createElement('span');
    lbl.style.cssText = 'font-size:9px;color:#777;font-family:monospace';
    lbl.textContent = def.label;
    miniCard.appendChild(lbl);

    const undoBtn = document.createElement('button'); undoBtn.style.display = 'none'; undoBtn.disabled = true;
    const redoBtn = document.createElement('button'); redoBtn.style.display = 'none'; redoBtn.disabled = true;
    const prev = prevStacks.get(egaKey);
    cardState.set(egaKey, {
      canvas, width: tile.width, height: tile.height, imageData: tile.imageData,
      mode: 'ega',
      undoStack: prev ? prev.undoStack : [], redoStack: prev ? prev.redoStack : [],
      undoBtn, redoBtn,
    });
    attachPaintHandlers(canvas, egaKey);
    row.appendChild(miniCard);
  }
  section.appendChild(row);
  container.appendChild(section);
}

function renderNormalCard(container, def, tile, prevStacks) {
  const egaKey = 'ega:' + def.tileIdx;
  const vgaIdx = EGA_TO_VGA_LOGO[def.tileIdx];
  const hasVGA = vgaIdx !== undefined && vgaTileset && vgaDecompressed;
  const vgaTile = hasVGA ? vgaTileset[vgaIdx] : null;
  const vgaKey = 'vga:' + def.tileIdx;

  const card = document.createElement('div');
  card.style.cssText = 'display:flex;flex-direction:column;gap:2px;background:#0a1628;border:1px solid #0f3460;border-radius:4px;padding:6px';

  // Label
  const lbl = document.createElement('span');
  lbl.style.cssText = 'font-size:11px;color:#aaa;font-family:monospace';
  lbl.textContent = `#${def.tileIdx} — ${def.label}${hasVGA ? '' : ' (EGA only)'}`;
  card.appendChild(lbl);

  // EGA toolbar
  const { bar: egaBar, undoBtn: egaUndoBtn, redoBtn: egaRedoBtn } = buildEGAToolbar(egaKey);
  card.appendChild(egaBar);

  // Canvas row
  const canvasRow = document.createElement('div');
  canvasRow.style.cssText = 'display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap';

  // EGA column
  const egaCol = document.createElement('div');
  egaCol.style.cssText = 'display:flex;flex-direction:column;gap:2px';
  if (hasVGA) {
    const egaLabel = document.createElement('span');
    egaLabel.style.cssText = 'font-size:9px;color:#55ff55;font-family:monospace';
    egaLabel.textContent = `EGA ${tile.width}×${tile.height}`;
    egaCol.appendChild(egaLabel);
  }
  const egaCanvas = document.createElement('canvas');
  egaCanvas.style.cssText = 'image-rendering:pixelated;cursor:crosshair;border:1px solid #0f3460;max-width:fit-content';
  renderCanvasFromImageData(egaCanvas, tile.imageData, tile.width, tile.height);
  egaCol.appendChild(egaCanvas);
  canvasRow.appendChild(egaCol);

  const prevEga = prevStacks.get(egaKey);
  cardState.set(egaKey, {
    canvas: egaCanvas, width: tile.width, height: tile.height, imageData: tile.imageData,
    mode: 'ega',
    undoStack: prevEga ? prevEga.undoStack : [], redoStack: prevEga ? prevEga.redoStack : [],
    undoBtn: egaUndoBtn, redoBtn: egaRedoBtn,
  });
  updateUndoRedoButtons(egaKey);
  attachPaintHandlers(egaCanvas, egaKey);

  // VGA column
  if (hasVGA && vgaTile) {
    const vgaCol = document.createElement('div');
    vgaCol.style.cssText = 'display:flex;flex-direction:column;gap:2px';

    const vgaLabel = document.createElement('span');
    vgaLabel.style.cssText = 'font-size:9px;color:#ffaa00;font-family:monospace';
    vgaLabel.textContent = `VGA ${vgaTile.width}×${vgaTile.height}`;
    vgaCol.appendChild(vgaLabel);

    const vgaCanvas = document.createElement('canvas');
    vgaCanvas.style.cssText = 'image-rendering:pixelated;cursor:crosshair;border:1px solid #664400;max-width:fit-content';
    const vgaBuild = buildVGAImageData(vgaTile);
    renderCanvasFromImageData(vgaCanvas, vgaBuild.imageData, vgaTile.width, vgaTile.height);
    vgaCol.appendChild(vgaCanvas);

    // VGA toolbar
    const { bar: vgaBar, undoBtn: vgaUndoBtn, redoBtn: vgaRedoBtn } = buildVGAToolbar(vgaKey, vgaTile);
    vgaCol.appendChild(vgaBar);
    canvasRow.appendChild(vgaCol);

    const prevVga = prevStacks.get(vgaKey);
    cardState.set(vgaKey, {
      canvas: vgaCanvas, width: vgaTile.width, height: vgaTile.height,
      imageData: vgaBuild.imageData, paletteIndices: vgaBuild.paletteIndices,
      mode: 'vga',
      undoStack: prevVga ? prevVga.undoStack : [], redoStack: prevVga ? prevVga.redoStack : [],
      undoBtn: vgaUndoBtn, redoBtn: vgaRedoBtn,
    });
    updateUndoRedoButtons(vgaKey);
    attachPaintHandlers(vgaCanvas, vgaKey);
  }

  card.appendChild(canvasRow);
  container.appendChild(card);
}

// ===== Paint handlers =====

function attachPaintHandlers(canvas, cardKey) {
  const cs = () => cardState.get(cardKey);

  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 2) return;
    e.preventDefault();
    const s = cs();
    if (s) {
      s.undoStack.push(snapshotCard(cardKey));
      if (s.undoStack.length > MAX_UNDO) s.undoStack.shift();
      s.redoStack.length = 0;
      updateUndoRedoButtons(cardKey);
    }
    isPainting = true;
    paintingCanvas = canvas;
    paintingCardKey = cardKey;
    paintPixels(e, cardKey);
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!isPainting || paintingCanvas !== canvas) return;
    paintPixels(e, cardKey);
  });

  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const s = cs();
    if (!s) return;
    const [x, y] = canvasMouseToPixel(e, canvas, s.width, s.height);
    if (x < 0 || x >= s.width || y < 0 || y >= s.height) return;

    const pixOff = (y * s.width + x) * 4;
    const r = s.imageData.data[pixOff];
    const g = s.imageData.data[pixOff + 1];
    const b = s.imageData.data[pixOff + 2];

    if (s.mode === 'vga' && vgaPalette) {
      // Find closest VGA palette index
      selectedVGAColor = findClosestPaletteIdx(r, g, b, vgaPalette);
      syncVGAPickers();
    } else {
      selectedEGAColor = findClosestPaletteIdx(r, g, b, EGA_PALETTE);
      syncEGAPickers();
    }
  });
}

function renderCanvasFromImageData(canvas, imageData, w, h) {
  canvas.width = w * logoZoom;
  canvas.height = h * logoZoom;
  const ctx = canvas.getContext('2d');
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  const tmpCtx = tmp.getContext('2d');
  const opaque = new ImageData(w, h);
  for (let i = 0; i < imageData.data.length; i += 4) {
    opaque.data[i] = imageData.data[i];
    opaque.data[i + 1] = imageData.data[i + 1];
    opaque.data[i + 2] = imageData.data[i + 2];
    opaque.data[i + 3] = 255;
  }
  tmpCtx.putImageData(opaque, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
}

function canvasMouseToPixel(e, canvas, w, h) {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left - 1) / (rect.width - 2) * w);
  const y = Math.floor((e.clientY - rect.top - 1) / (rect.height - 2) * h);
  return [x, y];
}

function paintPixels(e, cardKey) {
  const cs = cardState.get(cardKey);
  if (!cs) return;
  const { canvas, width: w, height: h, imageData, mode } = cs;

  const [cx, cy] = canvasMouseToPixel(e, canvas, w, h);
  const pal = (mode === 'vga' && vgaPalette) ? vgaPalette : EGA_PALETTE;
  const colorIdx = (mode === 'vga') ? selectedVGAColor : selectedEGAColor;
  const color = pal[colorIdx] || [0, 0, 0];
  const isTransparent = (mode === 'ega') ? (colorIdx === 0) : (colorIdx === 0);
  const half = Math.floor(brushSize / 2);

  let changed = false;
  for (let dy = -half; dy < brushSize - half; dy++) {
    for (let dx = -half; dx < brushSize - half; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || x >= w || y < 0 || y >= h) continue;
      const pixOff = (y * w + x) * 4;
      imageData.data[pixOff] = color[0];
      imageData.data[pixOff + 1] = color[1];
      imageData.data[pixOff + 2] = color[2];
      imageData.data[pixOff + 3] = isTransparent ? 0 : 255;
      // Track VGA palette index directly (avoids RGBA→index round-trip on flush)
      if (mode === 'vga' && cs.paletteIndices) {
        cs.paletteIndices[y * w + x] = isTransparent ? VGA_TRANSPARENT : colorIdx;
      }
      changed = true;
    }
  }
  if (changed) renderCanvasFromImageData(canvas, imageData, w, h);
}

function findClosestPaletteIdx(r, g, b, palette) {
  let best = 0, bestDist = Infinity;
  const len = Math.min(palette.length, 256);
  for (let i = 0; i < len; i++) {
    const c = palette[i];
    const dr = r - c[0], dg = g - c[1], db = b - c[2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

// ===== Flush paint data =====

function flushPaint(cardKey) {
  const [mode, idxStr] = cardKey.split(':');
  const egaTileIdx = parseInt(idxStr);

  if (mode === 'ega') {
    const tile = tileset[egaTileIdx];
    if (!tile) return;
    // Write EGA to DAV
    const encoded = encodeEGATile(tile.imageData, tile.width, tile.height);
    const dataStart = tile.offset + (tile.hasHeader ? 4 : 0);
    for (let i = 0; i < encoded.length; i++) davData[dataStart + i] = encoded[i];

    // Auto-sync to VGA
    if (vgaTileset && vgaDecompressed) {
      const vgaIdx = EGA_TO_VGA_LOGO[egaTileIdx];
      if (vgaIdx !== undefined) {
        const vgaTile = vgaTileset[vgaIdx];
        if (vgaTile) {
          const vgaPixels = encodeVGATile(tile.imageData, tile.width, tile.height);
          const syncW = Math.min(tile.width, vgaTile.width);
          const syncH = Math.min(tile.height, vgaTile.height);
          for (let y = 0; y < syncH; y++)
            for (let x = 0; x < syncW; x++)
              vgaDecompressed[vgaTile.dataStart + y * vgaTile.width + x] = vgaPixels[y * tile.width + x];
          if (appStateRef) appStateRef.vgaDirty = true;
          // Refresh VGA companion canvas
          const vgaCs = cardState.get('vga:' + egaTileIdx);
          if (vgaCs) {
            const vgaBuild = buildVGAImageData(vgaTile);
            vgaCs.imageData = vgaBuild.imageData;
            vgaCs.paletteIndices = vgaBuild.paletteIndices;
            renderCanvasFromImageData(vgaCs.canvas, vgaCs.imageData, vgaCs.width, vgaCs.height);
          }
        }
      }
    }
  } else if (mode === 'vga') {
    // Write VGA directly to decompressed bytes using tracked palette indices
    if (!vgaTileset || !vgaDecompressed) return;
    const vgaIdx = EGA_TO_VGA_LOGO[egaTileIdx];
    if (vgaIdx === undefined) return;
    const vgaTile = vgaTileset[vgaIdx];
    if (!vgaTile) return;
    const cs = cardState.get(cardKey);
    if (!cs) return;

    if (cs.paletteIndices) {
      // Use tracked palette indices directly — avoids RGBA→index round-trip
      // that can produce wrong indices for duplicate palette colors
      for (let y = 0; y < vgaTile.height; y++) {
        for (let x = 0; x < vgaTile.width; x++) {
          vgaDecompressed[vgaTile.dataStart + y * vgaTile.width + x] =
            cs.paletteIndices[y * vgaTile.width + x];
        }
      }
    } else {
      // Fallback: RGBA → closest palette index
      const pal = vgaPalette || EGA_PALETTE;
      for (let y = 0; y < vgaTile.height; y++) {
        for (let x = 0; x < vgaTile.width; x++) {
          const pixOff = (y * vgaTile.width + x) * 4;
          const a = cs.imageData.data[pixOff + 3];
          if (a === 0) {
            vgaDecompressed[vgaTile.dataStart + y * vgaTile.width + x] = VGA_TRANSPARENT;
          } else {
            const r = cs.imageData.data[pixOff];
            const g = cs.imageData.data[pixOff + 1];
            const b = cs.imageData.data[pixOff + 2];
            vgaDecompressed[vgaTile.dataStart + y * vgaTile.width + x] = findClosestPaletteIdx(r, g, b, pal);
          }
        }
      }
    }
    if (appStateRef) appStateRef.vgaDirty = true;
  }
}
