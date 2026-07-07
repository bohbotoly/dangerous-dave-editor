// Monster Editor - Placement and configuration
import { TILE_SIZE, MONSTER_STRUCT } from './constants.js';

let gameData = null;
let currentLevelIdx = 0;
let currentMonsterSlot = 0;
let renderCallback = null;

// Check if a level has a valid monster path (contains EA EA terminator)
function hasValidPath(levelIdx) {
  if (!gameData) return false;
  const pathData = gameData.levels[levelIdx].pathData;
  for (let i = 0; i < pathData.length - 1; i += 2) {
    if (pathData[i] === 0xEA && pathData[i + 1] === 0xEA) return true;
  }
  return false;
}

// Write a simple default patrol path: horizontal back-and-forth (±2px, 32 steps each way)
function writeDefaultPath(levelIdx) {
  const pathData = gameData.levels[levelIdx].pathData;
  let i = 0;
  // Move right: dx=2, dy=0 for 32 steps (64 pixels right)
  for (let s = 0; s < 32; s++) {
    pathData[i++] = 2;   // dx = +2
    pathData[i++] = 0;   // dy = 0
  }
  // Move left: dx=-2, dy=0 for 32 steps (64 pixels left = back to start)
  for (let s = 0; s < 32; s++) {
    pathData[i++] = 0xFE; // dx = -2 (signed)
    pathData[i++] = 0;    // dy = 0
  }
  // Terminator
  pathData[i++] = 0xEA;
  pathData[i++] = 0xEA;
  // Zero the rest
  while (i < pathData.length) pathData[i++] = 0;
  console.log(`Wrote default monster path for level ${levelIdx + 1} (${i} bytes)`);
}

export function initMonsterEditor(appState, onRender) {
  gameData = appState.gameData;
  renderCallback = onRender;
  buildMonsterUI();
  updateUI();
}

export function setLevel(levelIdx) {
  currentLevelIdx = levelIdx;
  updateUI();
}

export function placeMonster(col, row) {
  if (!gameData) return;
  const monster = gameData.monsters[currentLevelIdx][currentMonsterSlot];
  monster.enabled = 1;
  monster.x = col * TILE_SIZE;
  // Game stores foot-level Y (1 tile below sprite head).
  // Clicking row R means "put sprite here", so store (R+1)*TILE_SIZE.
  monster.y = (row + 1) * TILE_SIZE;
  // Ensure level has valid path data for monster patrol
  ensureValidPath(currentLevelIdx);
  updateUI();
  if (renderCallback) renderCallback();
}

// Auto-generate a default path if the level doesn't have one
function ensureValidPath(levelIdx) {
  if (!hasValidPath(levelIdx)) {
    writeDefaultPath(levelIdx);
  }
}

function buildMonsterUI() {
  const container = document.getElementById('monster-slots');
  container.innerHTML = '';

  for (let m = 0; m < MONSTER_STRUCT.MAX_MONSTERS; m++) {
    const slot = document.createElement('div');
    slot.className = 'monster-slot';
    slot.dataset.slot = m;

    slot.innerHTML = `
      <label>
        <input type="checkbox" class="mon-enabled" data-slot="${m}">
        Monster ${m + 1}
        <button class="mon-select-btn" data-slot="${m}" style="margin-left:auto;font-size:10px">Select</button>
      </label>
      <div class="mon-details" style="display:none">
        <label>X: <input type="number" class="mon-x" data-slot="${m}" min="0" max="1584"></label>
        <label>Y: <input type="number" class="mon-y" data-slot="${m}" min="0" max="144"></label>
        <label>Path Offset: <input type="number" class="mon-path" data-slot="${m}" min="0" max="255"></label>
        <label>Calmness: <input type="number" class="mon-calm" data-slot="${m}" min="-32768" max="32767"></label>
      </div>
    `;

    container.appendChild(slot);
  }

  // Event listeners
  container.addEventListener('change', (e) => {
    const slot = parseInt(e.target.dataset.slot);
    if (isNaN(slot)) return;
    const monster = gameData.monsters[currentLevelIdx][slot];

    if (e.target.classList.contains('mon-enabled')) {
      monster.enabled = e.target.checked ? 1 : 0;
      // Ensure valid path when enabling a monster
      if (monster.enabled) ensureValidPath(currentLevelIdx);
    } else if (e.target.classList.contains('mon-x')) {
      monster.x = parseInt(e.target.value) || 0;
    } else if (e.target.classList.contains('mon-y')) {
      monster.y = parseInt(e.target.value) || 0;
    } else if (e.target.classList.contains('mon-path')) {
      monster.pathOffset = parseInt(e.target.value) || 0;
    } else if (e.target.classList.contains('mon-calm')) {
      monster.calmness = parseInt(e.target.value) || 0;
    }

    updateUI();
    if (renderCallback) renderCallback();
  });

  container.addEventListener('click', (e) => {
    if (e.target.classList.contains('mon-select-btn')) {
      currentMonsterSlot = parseInt(e.target.dataset.slot);
      updateUI();
    }
  });
}

function updateUI() {
  if (!gameData) return;
  const monsters = gameData.monsters[currentLevelIdx];
  const container = document.getElementById('monster-slots');

  // Show warning for levels 1-2 (indices 0-1) which don't support monsters
  const warning = document.getElementById('monster-warning');
  if (warning) {
    warning.style.display = currentLevelIdx < 2 ? 'block' : 'none';
  }

  for (let m = 0; m < MONSTER_STRUCT.MAX_MONSTERS; m++) {
    const mon = monsters[m];
    const slot = container.querySelector(`[data-slot="${m}"].monster-slot`);
    if (!slot) continue;

    const enabled = mon.enabled !== 0;
    slot.classList.toggle('enabled', enabled);

    if (m === currentMonsterSlot) {
      slot.style.borderColor = '#55ff55';
    } else {
      slot.style.borderColor = enabled ? '#e94560' : '';
    }

    slot.querySelector('.mon-enabled').checked = enabled;
    const details = slot.querySelector('.mon-details');
    details.style.display = enabled ? 'block' : 'none';

    if (enabled) {
      slot.querySelector('.mon-x').value = mon.x;
      slot.querySelector('.mon-y').value = mon.y;
      slot.querySelector('.mon-path').value = mon.pathOffset;
      slot.querySelector('.mon-calm').value = mon.calmness;
    }
  }
}
