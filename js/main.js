// Dangerous Dave Editor - Main Entry Point
import { checkSignatureLZ91, unpackLZEXE } from './lzexe.js';
import { parseTileset } from './tileset-parser.js';
import { parseGameData, importLevelSet } from './exe-parser.js';
import { LEVEL_COUNT, TILE_NAMES, TILE_SOLID, TILE_HAZARD, TILE_CLIMBABLE, TILE_SPECIAL, TILE_COLLECTIBLE } from './constants.js';
import { initPalette, updateTileInfo, setPaletteAppState } from './tile-palette.js';
import { initLevelEditor, loadLevel, setSelectedTile, setTool, setCursorCallback, render, getCanvas } from './level-editor.js';
import { initPlayerEditor, setLevel as setPlayerLevel, placePlayer } from './player-editor.js';
import { initMonsterEditor, setLevel as setMonsterLevel, placeMonster } from './monster-editor.js';
import { initTitleEditor, setSelectedTile as setTitleTile } from './title-screen-editor.js';
import { initMenuEditor } from './menu-editor.js';
import { initLogoEditor } from './title-logo-editor.js';
import { initSpriteEditor } from './sprite-editor.js';
import { decompressKeenRLE, parseVGATileset, writeVGAToExe, surgicalWriteVGA, measureVGACompressedSize, parseVGAPalette, patchVGADecompressorBug, patchMonsterLevelClamp, patchWarpZoneCheck, patchDoorSolid } from './vga-parser.js';
import { downloadModifiedExe, downloadModifiedDav, downloadLevelSetJson } from './download.js';

const state = {
  exeLoaded: false,
  davLoaded: false,
  decompressedExe: null,
  gameData: null,
  tileset: null,
  davData: null,
  vgaTileset: null,
  vgaDecompressed: null,
  vgaDirty: false, // set true when logo editor modifies VGA pixel data
  vgaOriginalCompressedSize: 0, // bytes consumed by original compressed stream
  vgaOriginalCompressed: null,    // immutable copy of original compressed bytes
  vgaOriginalDecompressed: null,  // immutable copy of decompressed bytes before edits
  vgaPalette: null,               // 256-entry VGA palette [[r,g,b], ...] (0-255 range)
  currentLevel: 0,
  selectedTile: 1,
};

// File loading
document.getElementById('exe-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  setStatus('Loading EXE...');
  const buffer = await file.arrayBuffer();
  const data = new Uint8Array(buffer);

  if (checkSignatureLZ91(data)) {
    setStatus('Decompressing LZEXE...');
    try {
      state.decompressedExe = unpackLZEXE(data);
      setStatus(`EXE decompressed: ${state.decompressedExe.length} bytes`);
    } catch (err) {
      setStatus(`Decompression failed: ${err.message}`);
      return;
    }
  } else {
    state.decompressedExe = data;
    setStatus(`EXE loaded (already decompressed): ${data.length} bytes`);
  }

  state.gameData = parseGameData(state.decompressedExe);
  parseVGAFromExe();
  state.exeLoaded = true;
  updateLoadStatus();
  tryInitEditor();
});

document.getElementById('dav-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  setStatus('Loading DAV...');
  const buffer = await file.arrayBuffer();
  const data = new Uint8Array(buffer);

  try {
    state.davData = data;
    state.tileset = parseTileset(data);
    state.davLoaded = true;
    setStatus(`DAV loaded: ${state.tileset.length} tiles`);
  } catch (err) {
    setStatus(`DAV parsing failed: ${err.message}`);
    return;
  }

  updateLoadStatus();
  tryInitEditor();
});

// JSON level set import
document.getElementById('json-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  try {
    importLevelSet(text, state.gameData);
    loadLevel(state.currentLevel);
    setStatus('Level set imported');
  } catch (err) {
    setStatus(`Import failed: ${err.message}`);
  }
});

function updateLoadStatus() {
  const parts = [];
  if (state.exeLoaded) parts.push('EXE');
  if (state.davLoaded) parts.push('DAV');
  document.getElementById('load-status').textContent = parts.length ? `Loaded: ${parts.join(', ')}` : '';
}

function tryInitEditor() {
  if (!state.exeLoaded || !state.davLoaded) return;

  // Enable save buttons
  document.getElementById('btn-save-exe').disabled = false;
  document.getElementById('btn-save-dav').disabled = false;
  document.getElementById('btn-export-json').disabled = false;
  document.getElementById('import-label').style.display = '';

  // Init level editor
  initLevelEditor(state);

  // Store state for VGA palette rendering
  setPaletteAppState(state);

  // Init palette (pass state for VGA tile rendering)
  const palette = initPalette('palette-grid', state.tileset, (tileIdx) => {
    state.selectedTile = tileIdx;
    setSelectedTile(tileIdx);
    setTitleTile(tileIdx);
    updateTileInfo(tileIdx, state.tileset);
  }, state.selectedTile, state);

  // Init another palette for title screen
  initPalette('title-palette-grid', state.tileset, (tileIdx) => {
    state.selectedTile = tileIdx;
    setSelectedTile(tileIdx);
    setTitleTile(tileIdx);
    updateTileInfo(tileIdx, state.tileset);
  }, state.selectedTile, state);

  updateTileInfo(state.selectedTile, state.tileset);

  // Build level selector
  buildLevelSelector();

  // Init sub-editors
  initPlayerEditor(state, render);
  initMonsterEditor(state, render);
  initTitleEditor(state);
  initLogoEditor(state);
  initSpriteEditor(state);
  initMenuEditor(state);

  // Canvas events for player/monster placement
  const levelCanvas = getCanvas();
  levelCanvas.addEventListener('placePlayer', (e) => {
    placePlayer(e.detail.col, e.detail.row);
  });
  levelCanvas.addEventListener('placeMonster', (e) => {
    placeMonster(e.detail.col, e.detail.row);
  });
  levelCanvas.addEventListener('eyedropper', (e) => {
    state.selectedTile = e.detail.tileIdx;
    setSelectedTile(e.detail.tileIdx);
    palette.select(e.detail.tileIdx);
    updateTileInfo(e.detail.tileIdx, state.tileset);
  });

  // Cursor info
  setCursorCallback((col, row, tileIdx) => {
    document.getElementById('cursor-pos').textContent = `Col: ${col}, Row: ${row}`;
    const name = TILE_NAMES[tileIdx] || `Tile ${tileIdx}`;
    document.getElementById('cursor-tile').textContent = `Tile: #${tileIdx} ${name}`;
  });

  // Tool buttons
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tool = btn.dataset.tool;
      setTool(tool);

      // Show/hide player and monster panels
      document.getElementById('player-panel').style.display = tool === 'player' ? 'block' : 'none';
      document.getElementById('monster-panel').style.display = tool === 'monster' ? 'block' : 'none';
    });
  });

  setStatus('Editor ready! Select tiles from the palette and paint on the level grid.');
}

function buildLevelSelector() {
  const container = document.getElementById('level-selector');
  container.innerHTML = '';

  for (let i = 0; i < LEVEL_COUNT; i++) {
    const btn = document.createElement('button');
    btn.className = 'level-btn' + (i === 0 ? ' active' : '');
    btn.textContent = i + 1;
    btn.title = `Level ${i + 1}`;
    btn.addEventListener('click', () => {
      container.querySelectorAll('.level-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentLevel = i;
      loadLevel(i);
      setPlayerLevel(i);
      setMonsterLevel(i);
    });
    container.appendChild(btn);
  }
}

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    const tabId = tab.dataset.tab;
    document.querySelector(`.tab-content[data-tab="${tabId}"]`).classList.add('active');
  });
});

// Save buttons
document.getElementById('btn-save-exe').addEventListener('click', () => {
  // Only write VGA if logo sprites were actually edited
  if (state.vgaDirty && state.vgaDecompressed &&
      state.vgaOriginalCompressed && state.vgaOriginalDecompressed) {
    // Use surgical write: modify bytes directly in the original compressed
    // stream without full recompression. This preserves the exact chunk
    // structure, keeping DI alignment at the 64KB segment boundary correct
    // for the game's RLE decompressor (shared by VGA, CGA, and other data).
    const result = surgicalWriteVGA(
      state.gameData.rawExe,
      state.vgaOriginalCompressed,
      state.vgaOriginalDecompressed,
      state.vgaDecompressed,
      state.gameData._offsetDelta
    );
    if (!result.ok) {
      setStatus('Error: surgical VGA write failed');
      return;
    }
    if (result.rleConflicts > 0) {
      setStatus(
        `Warning: ${result.rleConflicts} RLE conflict(s) — some VGA pixels could not be applied. ` +
        `${result.changesApplied} changes applied successfully.`
      );
      // Still allow download — partial edits are better than no edits
    }
  }
  // Patch monster sprite formula to support levels 1-2 (clamp level-2 to min 0)
  // NOTE: Do NOT call patchVGADecompressorBug — it breaks VGA rendering
  patchMonsterLevelClamp(state.gameData.rawExe, state.gameData._offsetDelta);
  // Fix level 6 warp glitch: skip warp zone entry when mapping=0
  patchWarpZoneCheck(state.gameData.rawExe, state.gameData._offsetDelta);
  // Make doors solid until trophy is collected (prevents OOB level skip)
  patchDoorSolid(state.gameData.rawExe, state.gameData._offsetDelta);

  downloadModifiedExe(state.gameData);
  setStatus('Modified EXE downloaded');
});

document.getElementById('btn-save-dav').addEventListener('click', () => {
  if (state.davData) {
    downloadModifiedDav(state.davData);
    setStatus('Modified DAV downloaded');
  }
});

document.getElementById('btn-export-json').addEventListener('click', () => {
  downloadLevelSetJson(state.gameData);
  setStatus('Level set exported as JSON');
});

function parseVGAFromExe() {
  try {
    const vgaOffset = state.gameData._offsetDelta + 0x120F0; // EXE_OFFSETS.VGA_TILES
    state.vgaDecompressed = decompressKeenRLE(state.gameData.rawExe, vgaOffset);
    state.vgaTileset = parseVGATileset(state.vgaDecompressed);
    // Measure original compressed footprint — game code follows immediately after!
    state.vgaOriginalCompressedSize = measureVGACompressedSize(
      state.gameData.rawExe, state.gameData._offsetDelta
    );
    // Store immutable copies for surgical write (diff-based byte patching)
    // The surgery approach modifies individual bytes in the original compressed
    // stream without full recompression, preserving the game's RLE decompressor's
    // DI alignment at the 64KB segment boundary.
    state.vgaOriginalCompressed = new Uint8Array(
      state.gameData.rawExe.slice(vgaOffset, vgaOffset + state.vgaOriginalCompressedSize)
    );
    state.vgaOriginalDecompressed = new Uint8Array(state.vgaDecompressed);
    // Parse 256-color VGA palette from EXE
    state.vgaPalette = parseVGAPalette(state.gameData.rawExe, state.gameData._offsetDelta);
    console.log(`VGA tileset: ${state.vgaTileset.length} tiles, ${state.vgaDecompressed.length} bytes decompressed, ${state.vgaOriginalCompressedSize} bytes compressed`);
    console.log(`VGA palette loaded: ${state.vgaPalette.length} colors, first=[${state.vgaPalette[0]}], last=[${state.vgaPalette[255]}]`);
  } catch (err) {
    console.warn('VGA tile parsing failed (VGA edits disabled):', err);
    state.vgaTileset = null;
    state.vgaDecompressed = null;
    state.vgaOriginalCompressed = null;
    state.vgaOriginalDecompressed = null;
  }
}

function setStatus(text) {
  document.getElementById('status-text').textContent = text;
}

// Auto-load game files if served from dev server
async function tryAutoLoad() {
  try {
    const [exeResp, davResp] = await Promise.all([
      fetch('/gamefiles/DAVE.EXE'),
      fetch('/gamefiles/EGADAVE.DAV'),
    ]);
    if (!exeResp.ok || !davResp.ok) return;

    const exeData = new Uint8Array(await exeResp.arrayBuffer());
    if (checkSignatureLZ91(exeData)) {
      state.decompressedExe = unpackLZEXE(exeData);
    } else {
      state.decompressedExe = exeData;
    }
    state.gameData = parseGameData(state.decompressedExe);
    parseVGAFromExe();
    state.exeLoaded = true;

    const davData = new Uint8Array(await davResp.arrayBuffer());
    state.davData = davData;
    state.tileset = parseTileset(davData);
    state.davLoaded = true;

    updateLoadStatus();
    tryInitEditor();
    setStatus('Auto-loaded game files');
  } catch (e) {
    // Auto-load failed, user can load manually
  }
}
tryAutoLoad();
