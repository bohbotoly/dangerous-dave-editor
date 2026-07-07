// Player Start Position Editor
import { TILE_SIZE } from './constants.js';

let gameData = null;
let currentLevelIdx = 0;
let renderCallback = null;

export function initPlayerEditor(appState, onRender) {
  gameData = appState.gameData;
  renderCallback = onRender;

  const xInput = document.getElementById('player-x');
  const yInput = document.getElementById('player-y');
  const motionSelect = document.getElementById('player-motion');

  xInput.addEventListener('change', () => {
    gameData.playerStarts[currentLevelIdx].x = parseInt(xInput.value) || 0;
    if (renderCallback) renderCallback();
  });

  yInput.addEventListener('change', () => {
    gameData.playerStarts[currentLevelIdx].y = parseInt(yInput.value) || 0;
    if (renderCallback) renderCallback();
  });

  motionSelect.addEventListener('change', () => {
    gameData.playerStarts[currentLevelIdx].motionFlag = parseInt(motionSelect.value);
  });

  updateUI();
}

export function setLevel(levelIdx) {
  currentLevelIdx = levelIdx;
  updateUI();
}

export function placePlayer(col, row) {
  if (!gameData) return;
  gameData.playerStarts[currentLevelIdx].x = col * TILE_SIZE;
  // Game stores foot-level Y (1 tile below sprite head).
  // Clicking row R means "put sprite here", so store (R+1)*TILE_SIZE.
  gameData.playerStarts[currentLevelIdx].y = (row + 1) * TILE_SIZE;
  updateUI();
  if (renderCallback) renderCallback();
}

function updateUI() {
  if (!gameData) return;
  const start = gameData.playerStarts[currentLevelIdx];
  document.getElementById('player-x').value = start.x;
  document.getElementById('player-y').value = start.y;
  document.getElementById('player-motion').value = start.motionFlag;
}
