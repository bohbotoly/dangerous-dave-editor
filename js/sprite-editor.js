// Sprite Editor - Edit game sprites (Dave, monsters, projectiles)
// VGA sprites: 1 copy per frame, 1 byte/pixel (8bpp)
// EGA sprites: 4 pre-shifted copies per frame (for EGA byte-aligned blitting)
// VGA edits write directly to vgaDecompressed (saved via surgical write)
// EGA edits write to DAV data and auto-sync to VGA + regenerate shifted copies
import { EGA_PALETTE } from './constants.js';
import { encodeEGATile } from './tileset-parser.js';
import { encodeVGATile, getVGAPalette } from './vga-parser.js';

// ===== Sprite group definitions (VGA tile indices) =====
const SPRITE_GROUPS = [
  {
    heading: 'Dave - Walking & Standing',
    sprites: [
      { vga: 56, label: 'Standing' },
      { vga: 53, label: 'Walk Right 1' },
      { vga: 54, label: 'Walk Right 2' },
      { vga: 55, label: 'Walk Right 3' },
      { vga: 57, label: 'Walk Left 1' },
      { vga: 58, label: 'Walk Left 2' },
      { vga: 59, label: 'Walk Left 3' },
    ],
  },
  {
    heading: 'Dave - Jumping & Climbing',
    sprites: [
      { vga: 67, label: 'Jump Right' },
      { vga: 68, label: 'Jump Left' },
      { vga: 71, label: 'Climb 1' },
      { vga: 72, label: 'Climb 2' },
      { vga: 73, label: 'Climb 3' },
    ],
  },
  {
    heading: 'Dave - Jetpack',
    sprites: [
      { vga: 77, label: 'Jetpack Right 1' },
      { vga: 78, label: 'Jetpack Right 2' },
      { vga: 79, label: 'Jetpack Right 3' },
      { vga: 80, label: 'Jetpack Left 1' },
      { vga: 81, label: 'Jetpack Left 2' },
      { vga: 82, label: 'Jetpack Left 3' },
    ],
  },
  {
    heading: 'Dave - Death',
    collapsed: true,
    sprites: [
      { vga: 129, label: 'Death 1' },
      { vga: 130, label: 'Death 2' },
      { vga: 131, label: 'Death 3' },
      { vga: 132, label: 'Death 4' },
    ],
  },
  {
    heading: 'Dave - Other Frames',
    collapsed: true,
    sprites: [
      { vga: 60, label: 'Frame 60' },
      { vga: 61, label: 'Frame 61' },
      { vga: 62, label: 'Frame 62' },
      { vga: 63, label: 'Frame 63' },
      { vga: 64, label: 'Frame 64' },
      { vga: 65, label: 'Frame 65' },
      { vga: 66, label: 'Frame 66' },
      { vga: 69, label: 'Frame 69' },
      { vga: 70, label: 'Frame 70' },
      { vga: 74, label: 'Frame 74' },
      { vga: 75, label: 'Frame 75' },
      { vga: 76, label: 'Frame 76' },
      { vga: 83, label: 'Frame 83' },
      { vga: 84, label: 'Frame 84' },
      { vga: 85, label: 'Frame 85' },
      { vga: 86, label: 'Frame 86' },
      { vga: 87, label: 'Frame 87' },
      { vga: 88, label: 'Frame 88' },
    ],
  },
  {
    heading: 'Monsters',
    collapsed: true,
    sprites: (() => {
      const m = [];
      const names = [
        'Spider', 'Purple Thing', 'Red Sun', 'Green Face',
        'Small Fly', 'Fire Walker', 'Blue Face', 'Skeleton',
      ];
      for (let type = 0; type < 8; type++) {
        for (let frame = 0; frame < 4; frame++) {
          m.push({ vga: 89 + type * 4 + frame, label: `${names[type]} ${frame + 1}` });
        }
      }
      return m;
    })(),
  },
  {
    heading: 'Projectiles',
    collapsed: true,
    sprites: [
      { vga: 121, label: 'Enemy Bullet R' },
      { vga: 122, label: 'Proj. 122' },
      { vga: 123, label: 'Proj. 123' },
      { vga: 124, label: 'Enemy Bullet L' },
      { vga: 125, label: 'Proj. 125' },
      { vga: 126, label: 'Proj. 126' },
      { vga: 127, label: 'Dave Bullet R' },
      { vga: 128, label: 'Dave Bullet L' },
    ],
  },
];

// VGA sprite index → EGA primary copy tile index
// EGA has 4 pre-shifted copies per sprite: primary, +2px, +4px, +6px
function vgaToEgaPrimary(vgaIdx) {
  return 53 + (vgaIdx - 53) * 4;
}

// ===== Module state =====
const VGA_TRANSPARENT = 230;
const MAX_UNDO = 60;

let appStateRef = null;
let tileset = null;
let davData = null;
let vgaTileset = null;
let vgaDecompressed = null;
let vgaPalette = null;
let spriteZoom = 4;

// Global painting state
let selectedEGAColor = 14;
let selectedVGAColor = 14;
let brushSize = 1;
let isPainting = false;
let paintingCanvas = null;
let paintingCardKey = null;

// Per-canvas state: "vga:VGA_IDX" or "ega:VGA_IDX"
const cardState = new Map();

// ===== Init =====

export function initSpriteEditor(state) {
  appStateRef = state;
  tileset = state.tileset;
  davData = state.davData;
  vgaTileset = state.vgaTileset;
  vgaDecompressed = state.vgaDecompressed;
  vgaPalette = state.vgaPalette || getVGAPalette();

  if (!tileset || !davData) return;

  const zoomSlider = document.getElementById('sprite-zoom');
  if (zoomSlider) {
    zoomSlider.addEventListener('input', (e) => {
      spriteZoom = parseInt(e.target.value);
      renderAllSprites();
    });
  }

  document.addEventListener('mouseup', () => {
    if (isPainting && paintingCardKey && isTabActive()) {
      isPainting = false;
      flushPaint(paintingCardKey);
      paintingCanvas = null;
      paintingCardKey = null;
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!isTabActive()) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      const key = paintingCardKey || findLastEditedKey('undo');
      if (key) performUndo(key);
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      const key = paintingCardKey || findLastEditedKey('redo');
      if (key) performRedo(key);
    }
  });

  renderAllSprites();
}

function isTabActive() {
  const tab = document.querySelector('.tab-content[data-tab="sprites"]');
  return tab && tab.classList.contains('active');
}

function findLastEditedKey(type) {
  for (const [k, cs] of cardState) {
    if (type === 'undo' && cs.undoStack.length > 0) return k;
    if (type === 'redo' && cs.redoStack.length > 0) return k;
  }
  return null;
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
      }
    }
  }
  return { imageData, paletteIndices };
}

// ===== Rendering =====

function renderAllSprites() {
  const container = document.getElementById('sprite-cards-container');
  if (!container) return;
  container.innerHTML = '';

  // Preserve undo stacks
  const prevStacks = new Map();
  for (const [key, cs] of cardState) {
    prevStacks.set(key, { undoStack: cs.undoStack, redoStack: cs.redoStack });
  }
  cardState.clear();

  // Shared toolbar
  const toolbar = buildSharedToolbar();
  container.appendChild(toolbar);

  // Render groups
  for (const group of SPRITE_GROUPS) {
    const section = document.createElement('div');
    section.style.cssText = 'margin-bottom:12px';

    // Collapsible heading
    const heading = document.createElement('h4');
    heading.style.cssText = 'color:#55ffff;margin:8px 0 6px;font-size:13px;cursor:pointer;user-select:none';
    const arrow = document.createElement('span');
    arrow.textContent = group.collapsed ? '▶ ' : '▼ ';
    arrow.style.cssText = 'font-size:10px;margin-right:4px';
    heading.appendChild(arrow);
    heading.appendChild(document.createTextNode(group.heading));

    const grid = document.createElement('div');
    grid.style.cssText = group.collapsed
      ? 'display:none'
      : 'display:flex;flex-wrap:wrap;gap:8px';

    heading.addEventListener('click', () => {
      const hidden = grid.style.display === 'none';
      grid.style.cssText = hidden
        ? 'display:flex;flex-wrap:wrap;gap:8px'
        : 'display:none';
      arrow.textContent = hidden ? '▼ ' : '▶ ';
    });

    section.appendChild(heading);
    section.appendChild(grid);

    for (const def of group.sprites) {
      renderSpriteCard(grid, def, prevStacks);
    }

    container.appendChild(section);
  }
}

function buildSharedToolbar() {
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 8px;background:#0a1628;border:1px solid #0f3460;border-radius:4px;margin-bottom:8px;position:sticky;top:0;z-index:10';

  // EGA palette
  const egaLabel = document.createElement('span');
  egaLabel.style.cssText = 'font-size:10px;color:#55ff55';
  egaLabel.textContent = 'EGA:';
  bar.appendChild(egaLabel);
  const egaPicker = document.createElement('div');
  egaPicker.id = 'sprite-ega-picker';
  egaPicker.style.cssText = 'display:flex;gap:1px;flex-wrap:wrap';
  for (let i = 0; i < 16; i++) {
    const swatch = makeSwatch(EGA_PALETTE[i], i, i === selectedEGAColor);
    swatch.addEventListener('click', () => { selectedEGAColor = i; syncPickers(); });
    egaPicker.appendChild(swatch);
  }
  bar.appendChild(egaPicker);
  bar.appendChild(makeSep());

  // VGA palette (first 16 + custom index input)
  const vgaLabel = document.createElement('span');
  vgaLabel.style.cssText = 'font-size:10px;color:#ffaa00';
  vgaLabel.textContent = 'VGA:';
  bar.appendChild(vgaLabel);
  const vgaPicker = document.createElement('div');
  vgaPicker.id = 'sprite-vga-picker';
  vgaPicker.style.cssText = 'display:flex;gap:1px;flex-wrap:wrap;align-items:center';
  const pal = vgaPalette || EGA_PALETTE;
  for (let i = 0; i < 16; i++) {
    const swatch = makeSwatch(pal[i], i, i === selectedVGAColor);
    swatch.addEventListener('click', () => { selectedVGAColor = i; syncPickers(); });
    vgaPicker.appendChild(swatch);
  }
  // Custom VGA index input
  const idxLabel = document.createElement('span');
  idxLabel.style.cssText = 'font-size:9px;color:#777;margin-left:4px';
  idxLabel.textContent = 'idx:';
  vgaPicker.appendChild(idxLabel);
  const idxInput = document.createElement('input');
  idxInput.type = 'number'; idxInput.min = 0; idxInput.max = 255;
  idxInput.value = selectedVGAColor;
  idxInput.id = 'sprite-vga-idx';
  idxInput.style.cssText = 'width:40px;background:#0d1b2a;border:1px solid #0f3460;color:#ffaa00;font-size:10px;padding:1px 3px;font-family:monospace';
  idxInput.addEventListener('change', () => {
    selectedVGAColor = Math.max(0, Math.min(255, parseInt(idxInput.value) || 0));
    syncPickers();
  });
  vgaPicker.appendChild(idxInput);
  bar.appendChild(vgaPicker);
  bar.appendChild(makeSep());

  // Brush size
  const brushGroup = document.createElement('div');
  brushGroup.id = 'sprite-brush-group';
  brushGroup.style.cssText = 'display:flex;align-items:center;gap:2px';
  const bl = document.createElement('span');
  bl.style.cssText = 'font-size:10px;color:#777'; bl.textContent = 'Brush:';
  brushGroup.appendChild(bl);
  for (const size of [1, 2, 3, 5]) {
    const btn = document.createElement('button');
    btn.textContent = `${size}`; btn.dataset.size = size;
    btn.style.cssText = 'font-size:9px;padding:1px 4px;cursor:pointer;background:#0d1b2a;color:#e0e0e0;border:1px solid #0f3460;border-radius:2px;min-width:18px';
    if (size === brushSize) btn.style.borderColor = '#55ff55';
    btn.addEventListener('click', () => { brushSize = size; syncPickers(); });
    brushGroup.appendChild(btn);
  }
  bar.appendChild(brushGroup);

  // Hint
  const hint = document.createElement('span');
  hint.style.cssText = 'font-size:9px;color:#555;margin-left:4px';
  hint.textContent = 'Right-click = eyedropper';
  bar.appendChild(hint);

  return bar;
}

function renderSpriteCard(container, def, prevStacks) {
  const { vga: vgaIdx, label } = def;
  const egaPrimIdx = vgaToEgaPrimary(vgaIdx);
  const egaTile = tileset ? tileset[egaPrimIdx] : null;
  const vgaTile = (vgaTileset && vgaDecompressed) ? vgaTileset[vgaIdx] : null;
  if (!egaTile && !vgaTile) return;

  const card = document.createElement('div');
  card.style.cssText = 'display:flex;flex-direction:column;gap:2px;background:#0a1628;border:1px solid #0f3460;border-radius:4px;padding:6px;min-width:100px';

  // Label
  const lbl = document.createElement('span');
  lbl.style.cssText = 'font-size:10px;color:#aaa;font-family:monospace;white-space:nowrap';
  lbl.textContent = `V${vgaIdx} E${egaPrimIdx} ${label}`;
  card.appendChild(lbl);

  // Canvas row
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:6px;align-items:flex-start';

  // VGA canvas
  if (vgaTile) {
    const vgaKey = 'vga:' + vgaIdx;
    const col = document.createElement('div');
    col.style.cssText = 'display:flex;flex-direction:column;gap:1px;align-items:center';

    const vLabel = document.createElement('span');
    vLabel.style.cssText = 'font-size:8px;color:#ffaa00;font-family:monospace';
    vLabel.textContent = `VGA ${vgaTile.width}×${vgaTile.height}`;
    col.appendChild(vLabel);

    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'image-rendering:pixelated;cursor:crosshair;border:1px solid #664400';
    const vgaBuild = buildVGAImageData(vgaTile);
    renderCanvas(canvas, vgaBuild.imageData, vgaTile.width, vgaTile.height);
    col.appendChild(canvas);

    const prev = prevStacks.get(vgaKey);
    cardState.set(vgaKey, {
      canvas, width: vgaTile.width, height: vgaTile.height,
      imageData: vgaBuild.imageData, paletteIndices: vgaBuild.paletteIndices,
      mode: 'vga', vgaIdx,
      undoStack: prev ? prev.undoStack : [], redoStack: prev ? prev.redoStack : [],
    });
    attachPaintHandlers(canvas, vgaKey);
    row.appendChild(col);
  }

  // EGA canvas (primary copy)
  if (egaTile) {
    const egaKey = 'ega:' + vgaIdx;
    const col = document.createElement('div');
    col.style.cssText = 'display:flex;flex-direction:column;gap:1px;align-items:center';

    const eLabel = document.createElement('span');
    eLabel.style.cssText = 'font-size:8px;color:#55ff55;font-family:monospace';
    eLabel.textContent = `EGA ${egaTile.width}×${egaTile.height}`;
    col.appendChild(eLabel);

    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'image-rendering:pixelated;cursor:crosshair;border:1px solid #0f3460';
    renderCanvas(canvas, egaTile.imageData, egaTile.width, egaTile.height);
    col.appendChild(canvas);

    const prev = prevStacks.get(egaKey);
    cardState.set(egaKey, {
      canvas, width: egaTile.width, height: egaTile.height,
      imageData: egaTile.imageData,
      mode: 'ega', vgaIdx,
      undoStack: prev ? prev.undoStack : [], redoStack: prev ? prev.redoStack : [],
    });
    attachPaintHandlers(canvas, egaKey);
    row.appendChild(col);
  }

  card.appendChild(row);

  // Undo/redo buttons
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:3px;margin-top:2px';
  const undoBtn = makeBtn('↩', () => {
    if (vgaTile) performUndo('vga:' + vgaIdx);
    if (egaTile) performUndo('ega:' + vgaIdx);
  });
  const redoBtn = makeBtn('↪', () => {
    if (vgaTile) performRedo('vga:' + vgaIdx);
    if (egaTile) performRedo('ega:' + vgaIdx);
  });
  btnRow.appendChild(undoBtn);
  btnRow.appendChild(redoBtn);
  card.appendChild(btnRow);

  container.appendChild(card);
}

// ===== Paint handlers =====

function attachPaintHandlers(canvas, cardKey) {
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 2) return;
    e.preventDefault();
    const cs = cardState.get(cardKey);
    if (cs) {
      cs.undoStack.push(snapshotCard(cardKey));
      if (cs.undoStack.length > MAX_UNDO) cs.undoStack.shift();
      cs.redoStack.length = 0;
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
    const cs = cardState.get(cardKey);
    if (!cs) return;
    const [x, y] = mouseToPixel(e, canvas, cs.width, cs.height);
    if (x < 0 || x >= cs.width || y < 0 || y >= cs.height) return;

    if (cs.mode === 'vga' && cs.paletteIndices) {
      selectedVGAColor = cs.paletteIndices[y * cs.width + x];
      syncPickers();
    } else {
      const pixOff = (y * cs.width + x) * 4;
      selectedEGAColor = closestEGA(
        cs.imageData.data[pixOff], cs.imageData.data[pixOff + 1], cs.imageData.data[pixOff + 2]
      );
      syncPickers();
    }
  });
}

function paintPixels(e, cardKey) {
  const cs = cardState.get(cardKey);
  if (!cs) return;
  const { canvas, width: w, height: h, imageData, mode } = cs;

  const [cx, cy] = mouseToPixel(e, canvas, w, h);
  const pal = (mode === 'vga' && vgaPalette) ? vgaPalette : EGA_PALETTE;
  const colorIdx = (mode === 'vga') ? selectedVGAColor : selectedEGAColor;
  const color = pal[colorIdx] || [0, 0, 0];
  const isTransparent = (colorIdx === 0);
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
      if (mode === 'vga' && cs.paletteIndices) {
        cs.paletteIndices[y * w + x] = isTransparent ? VGA_TRANSPARENT : colorIdx;
      }
      changed = true;
    }
  }
  if (changed) renderCanvas(canvas, imageData, w, h);
}

// ===== Flush paint to game data =====

function flushPaint(cardKey) {
  const [mode, idxStr] = cardKey.split(':');
  const vgaIdx = parseInt(idxStr);

  if (mode === 'ega') {
    flushEGA(vgaIdx);
  } else if (mode === 'vga') {
    flushVGA(vgaIdx);
  }
}

function flushEGA(vgaIdx) {
  const egaPrimIdx = vgaToEgaPrimary(vgaIdx);
  const tile = tileset[egaPrimIdx];
  if (!tile || !davData) return;

  // Write primary copy to DAV
  const encoded = encodeEGATile(tile.imageData, tile.width, tile.height);
  const dataStart = tile.offset + (tile.hasHeader ? 4 : 0);
  for (let i = 0; i < encoded.length; i++) davData[dataStart + i] = encoded[i];

  // Regenerate 3 shifted EGA copies
  regenerateShiftedCopies(vgaIdx, tile.imageData, tile.width, tile.height);

  // Auto-sync EGA → VGA
  if (vgaTileset && vgaDecompressed) {
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
      const vgaCs = cardState.get('vga:' + vgaIdx);
      if (vgaCs) {
        const vgaBuild = buildVGAImageData(vgaTile);
        vgaCs.imageData = vgaBuild.imageData;
        vgaCs.paletteIndices = vgaBuild.paletteIndices;
        renderCanvas(vgaCs.canvas, vgaCs.imageData, vgaCs.width, vgaCs.height);
      }
    }
  }
}

function flushVGA(vgaIdx) {
  if (!vgaTileset || !vgaDecompressed) return;
  const vgaTile = vgaTileset[vgaIdx];
  if (!vgaTile) return;
  const cs = cardState.get('vga:' + vgaIdx);
  if (!cs) return;

  if (cs.paletteIndices) {
    for (let y = 0; y < vgaTile.height; y++)
      for (let x = 0; x < vgaTile.width; x++)
        vgaDecompressed[vgaTile.dataStart + y * vgaTile.width + x] =
          cs.paletteIndices[y * vgaTile.width + x];
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
          vgaDecompressed[vgaTile.dataStart + y * vgaTile.width + x] = closestVGA(
            cs.imageData.data[pixOff], cs.imageData.data[pixOff + 1], cs.imageData.data[pixOff + 2], pal
          );
        }
      }
    }
  }
  if (appStateRef) appStateRef.vgaDirty = true;
}

// ===== EGA shifted copy regeneration =====
// EGA sprites have 4 copies at consecutive tile indices.
// Copy 0 (primary): sprite at natural position
// Copy 1: shifted right 2px (for x % 8 == 2)
// Copy 2: shifted right 4px (for x % 8 == 4)
// Copy 3: shifted right 6px (for x % 8 == 6)

function regenerateShiftedCopies(vgaIdx, primaryImageData, w, h) {
  if (!tileset || !davData) return;
  const egaPrimIdx = vgaToEgaPrimary(vgaIdx);

  for (let copyNum = 1; copyNum <= 3; copyNum++) {
    const shift = copyNum * 2;
    const egaIdx = egaPrimIdx + copyNum;
    const tile = tileset[egaIdx];
    if (!tile) continue;

    // Create shifted ImageData
    const shifted = new ImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const srcX = x - shift;
        const dstOff = (y * w + x) * 4;
        if (srcX >= 0 && srcX < w) {
          const srcOff = (y * w + srcX) * 4;
          shifted.data[dstOff] = primaryImageData.data[srcOff];
          shifted.data[dstOff + 1] = primaryImageData.data[srcOff + 1];
          shifted.data[dstOff + 2] = primaryImageData.data[srcOff + 2];
          shifted.data[dstOff + 3] = primaryImageData.data[srcOff + 3];
        }
        // else: stays 0,0,0,0 (transparent)
      }
    }

    // Encode and write to DAV
    const encoded = encodeEGATile(shifted, w, h);
    const dataStart = tile.offset + (tile.hasHeader ? 4 : 0);
    for (let i = 0; i < encoded.length; i++) davData[dataStart + i] = encoded[i];

    // Update the in-memory tile imageData too
    tile.imageData = shifted;
  }
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
  renderCanvas(cs.canvas, cs.imageData, cs.width, cs.height);
}

function performUndo(key) {
  const cs = cardState.get(key);
  if (!cs || cs.undoStack.length === 0) return;
  cs.redoStack.push(snapshotCard(key));
  restoreSnapshot(cs.undoStack.pop());
}

function performRedo(key) {
  const cs = cardState.get(key);
  if (!cs || cs.redoStack.length === 0) return;
  cs.undoStack.push(snapshotCard(key));
  restoreSnapshot(cs.redoStack.pop());
}

// ===== Helper functions =====

function renderCanvas(canvas, imageData, w, h) {
  canvas.width = w * spriteZoom;
  canvas.height = h * spriteZoom;
  const ctx = canvas.getContext('2d');
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  const tmpCtx = tmp.getContext('2d');
  // Render opaque (transparent shows as black background)
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

function mouseToPixel(e, canvas, w, h) {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left - 1) / (rect.width - 2) * w);
  const y = Math.floor((e.clientY - rect.top - 1) / (rect.height - 2) * h);
  return [x, y];
}

function makeSwatch(rgb, idx, isSelected) {
  const s = document.createElement('div');
  s.className = 'color-swatch';
  s.dataset.idx = idx;
  if (isSelected) s.classList.add('selected');
  s.style.cssText = `width:14px;height:14px;border-radius:2px;cursor:pointer;border:1px solid #333;box-sizing:border-box;background:rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  s.title = `#${idx}`;
  return s;
}

function makeSep() {
  const sep = document.createElement('div');
  sep.style.cssText = 'width:1px;height:16px;background:#0f3460';
  return sep;
}

function makeBtn(text, onClick) {
  const btn = document.createElement('button');
  btn.textContent = text;
  btn.style.cssText = 'font-size:10px;padding:1px 5px;cursor:pointer;background:#0d1b2a;color:#e0e0e0;border:1px solid #0f3460;border-radius:2px';
  btn.addEventListener('click', onClick);
  return btn;
}

function syncPickers() {
  // EGA swatches
  const egaPicker = document.getElementById('sprite-ega-picker');
  if (egaPicker) {
    egaPicker.querySelectorAll('.color-swatch').forEach(s => {
      s.classList.toggle('selected', parseInt(s.dataset.idx) === selectedEGAColor);
    });
  }
  // VGA swatches
  const vgaPicker = document.getElementById('sprite-vga-picker');
  if (vgaPicker) {
    vgaPicker.querySelectorAll('.color-swatch').forEach(s => {
      s.classList.toggle('selected', parseInt(s.dataset.idx) === selectedVGAColor);
    });
  }
  // VGA index input
  const idxInput = document.getElementById('sprite-vga-idx');
  if (idxInput) idxInput.value = selectedVGAColor;
  // Brush buttons
  const brushGroup = document.getElementById('sprite-brush-group');
  if (brushGroup) {
    brushGroup.querySelectorAll('button').forEach(b => {
      b.style.borderColor = parseInt(b.dataset.size) === brushSize ? '#55ff55' : '#0f3460';
    });
  }
}

function closestEGA(r, g, b) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < 16; i++) {
    const c = EGA_PALETTE[i];
    const d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function closestVGA(r, g, b, pal) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < Math.min(pal.length, 256); i++) {
    const c = pal[i];
    const d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
