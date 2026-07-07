// Tile Palette - Sidebar tile selection
import {
  LEVEL_TILE_COUNT, TILE_SOLID, TILE_HAZARD, TILE_CLIMBABLE,
  TILE_SPECIAL, TILE_COLLECTIBLE, TILE_NAMES
} from './constants.js';
import { tileToCanvasOpaque } from './tileset-parser.js';
import { vgaTileToCanvas } from './vga-parser.js';

const GROUPS = [
  { label: 'Empty', tiles: [0] },
  { label: 'Solid Blocks', tiles: [1, 3, 5, 15, 16, 17, 18, 19, 21, 22, 23, 24, 29, 30] },
  { label: 'Hazards', tiles: [6, 25, 36] },
  { label: 'Climbable', tiles: [33, 34, 35, 41] },
  { label: 'Special Items', tiles: [2, 4, 10, 20] },
  { label: 'Collectibles', tiles: [47, 48, 49, 50, 51, 52] },
  { label: 'Decorative', tiles: [7, 8, 9, 11, 12, 13, 14, 26, 27, 28, 31, 32, 37, 38, 39, 40, 42, 43, 44, 45, 46] },
];

export function initPalette(containerId, tileset, onSelect, initialTile = 1, appState = null) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  // Use VGA tiles when available, fall back to EGA
  const hasVGA = appState && appState.vgaTileset && appState.vgaDecompressed && appState.vgaPalette;

  const tileCanvases = new Map();
  let selectedEl = null;
  let currentTile = initialTile;

  for (const group of GROUPS) {
    const label = document.createElement('div');
    label.className = 'palette-group-label';
    label.textContent = group.label;
    container.appendChild(label);

    for (const tileIdx of group.tiles) {
      if (tileIdx >= tileset.length) continue;

      const wrapper = document.createElement('div');
      wrapper.className = 'palette-tile';
      wrapper.dataset.tile = tileIdx;

      let canvas;
      if (hasVGA && tileIdx < appState.vgaTileset.length) {
        canvas = vgaTileToCanvas(
          appState.vgaTileset, appState.vgaDecompressed, appState.vgaPalette,
          tileIdx, true
        );
      } else {
        canvas = tileToCanvasOpaque(tileset[tileIdx]);
      }
      canvas.style.width = '32px';
      canvas.style.height = '32px';
      wrapper.appendChild(canvas);

      wrapper.addEventListener('click', () => {
        if (selectedEl) selectedEl.classList.remove('selected');
        wrapper.classList.add('selected');
        selectedEl = wrapper;
        currentTile = tileIdx;
        onSelect(tileIdx);
      });

      wrapper.addEventListener('mouseenter', (e) => showTooltip(e, tileIdx));
      wrapper.addEventListener('mouseleave', hideTooltip);

      if (tileIdx === initialTile) {
        wrapper.classList.add('selected');
        selectedEl = wrapper;
      }

      container.appendChild(wrapper);
      tileCanvases.set(tileIdx, canvas);
    }
  }

  return {
    getSelected: () => currentTile,
    select: (tileIdx) => {
      const el = container.querySelector(`[data-tile="${tileIdx}"]`);
      if (el) {
        if (selectedEl) selectedEl.classList.remove('selected');
        el.classList.add('selected');
        selectedEl = el;
        currentTile = tileIdx;
      }
    },
  };
}

let tooltipEl = null;

function showTooltip(e, tileIdx) {
  hideTooltip();
  const name = TILE_NAMES[tileIdx] || `Tile ${tileIdx}`;
  const props = getTileProps(tileIdx);

  tooltipEl = document.createElement('div');
  tooltipEl.className = 'tile-tooltip';
  tooltipEl.innerHTML = `<b>#${tileIdx}</b> ${name}${props ? '<br>' + props : ''}`;

  document.body.appendChild(tooltipEl);

  const rect = e.target.getBoundingClientRect();
  tooltipEl.style.left = (rect.right + 4) + 'px';
  tooltipEl.style.top = rect.top + 'px';
}

function hideTooltip() {
  if (tooltipEl) {
    tooltipEl.remove();
    tooltipEl = null;
  }
}

function getTileProps(tileIdx) {
  const parts = [];
  if (TILE_SOLID.has(tileIdx)) parts.push('Solid');
  if (TILE_HAZARD.has(tileIdx)) parts.push('Hazard');
  if (TILE_CLIMBABLE.has(tileIdx)) parts.push('Climbable');
  if (TILE_SPECIAL[tileIdx]) parts.push(TILE_SPECIAL[tileIdx]);
  if (TILE_COLLECTIBLE[tileIdx]) parts.push(`${TILE_COLLECTIBLE[tileIdx]} pts`);
  return parts.join(', ');
}

// Store appState for updateTileInfo VGA rendering
let _paletteAppState = null;
export function setPaletteAppState(appState) { _paletteAppState = appState; }

// Update the properties panel with info about a tile
export function updateTileInfo(tileIdx, tileset) {
  const preview = document.getElementById('selected-tile-preview');
  const nameEl = document.getElementById('selected-tile-name');
  const propsEl = document.getElementById('selected-tile-props');

  if (!preview || !tileset || tileIdx >= tileset.length) return;

  preview.innerHTML = '';
  let canvas;
  const s = _paletteAppState;
  if (s && s.vgaTileset && s.vgaDecompressed && s.vgaPalette && tileIdx < s.vgaTileset.length) {
    canvas = vgaTileToCanvas(s.vgaTileset, s.vgaDecompressed, s.vgaPalette, tileIdx, true);
  } else {
    canvas = tileToCanvasOpaque(tileset[tileIdx]);
  }
  canvas.style.width = '64px';
  canvas.style.height = '64px';
  preview.appendChild(canvas);

  nameEl.textContent = `#${tileIdx} - ${TILE_NAMES[tileIdx] || 'Unknown'}`;

  const props = getTileProps(tileIdx);
  propsEl.textContent = props || 'Decorative';
}
