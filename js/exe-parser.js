// Decompressed DAVE.EXE Data Parser & Writer
import {
  EXE_OFFSETS, LEVEL_COUNT, LEVEL_TOTAL_BYTES, LEVEL_PATH_BYTES,
  LEVEL_TILE_BYTES, LEVEL_PADDING_BYTES, LEVEL_WIDTH, LEVEL_HEIGHT,
  TITLE_WIDTH, TITLE_HEIGHT, MONSTER_STRUCT
} from './constants.js';

// EXE_OFFSETS are documented for a 512-byte (32-paragraph) MZ header.
// Different LZEXE decompressors produce different header sizes.
// Compute the delta to adjust all offsets for the actual header.
const REFERENCE_HEADER_SIZE = 512;

function computeOffsetDelta(exeData) {
  const headerParagraphs = exeData[0x08] | (exeData[0x09] << 8);
  return (headerParagraphs * 16) - REFERENCE_HEADER_SIZE;
}

// Cache the delta per parse session
let offsetDelta = 0;

function off(refOffset) {
  return refOffset + offsetDelta;
}

export function parseGameData(exeData) {
  offsetDelta = computeOffsetDelta(exeData);
  return {
    levels: parseLevels(exeData),
    playerStarts: parsePlayerStarts(exeData),
    monsters: parseMonsters(exeData),
    collectibles: parseCollectibles(exeData),
    titleScreen: parseTitleScreen(exeData),
    warpZones: parseWarpZones(exeData),
    rawExe: new Uint8Array(exeData),
    _offsetDelta: offsetDelta,
  };
}

function parseLevels(data) {
  const levels = [];
  const baseOffset = off(EXE_OFFSETS.LEVEL_DATA);

  for (let i = 0; i < LEVEL_COUNT; i++) {
    const levelOffset = baseOffset + i * LEVEL_TOTAL_BYTES;

    // Path data: 256 bytes (128 signed X,Y pairs) — stored first
    const pathData = new Uint8Array(data.slice(levelOffset, levelOffset + LEVEL_PATH_BYTES));

    // Tile map: 1000 bytes (100 x 10) — after path data
    const tileOffset = levelOffset + LEVEL_PATH_BYTES;
    const tileMap = new Uint8Array(data.slice(tileOffset, tileOffset + LEVEL_TILE_BYTES));

    // Padding: 24 bytes
    const paddingOffset = tileOffset + LEVEL_TILE_BYTES;
    const padding = new Uint8Array(data.slice(paddingOffset, paddingOffset + LEVEL_PADDING_BYTES));

    levels.push({ pathData, tileMap, padding });
  }

  return levels;
}

function parsePlayerStarts(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const starts = [];

  for (let i = 0; i < LEVEL_COUNT; i++) {
    starts.push({
      motionFlag: data[off(EXE_OFFSETS.PLAYER_MOTION_FLAGS) + i],
      x: view.getUint16(off(EXE_OFFSETS.PLAYER_START_X) + i * 2, true),
      y: view.getUint16(off(EXE_OFFSETS.PLAYER_START_Y) + i * 2, true),
    });
  }

  return starts;
}

function parseMonsters(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const monsters = [];

  for (let lvl = 0; lvl < LEVEL_COUNT; lvl++) {
    const base = off(EXE_OFFSETS.MONSTER_DATA) + lvl * MONSTER_STRUCT.TOTAL_SIZE;
    const levelMonsters = [];

    for (let m = 0; m < MONSTER_STRUCT.MAX_MONSTERS; m++) {
      levelMonsters.push({
        enabled: view.getUint16(base + m * 2, true),
        x: view.getUint16(base + 8 + m * 2, true),
        y: view.getUint16(base + 16 + m * 2, true),
        pathOffset: view.getUint16(base + 24 + m * 2, true),
        calmness: view.getInt16(base + 32 + m * 2, true),
      });
    }

    monsters.push(levelMonsters);
  }

  return monsters;
}

function parseCollectibles(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const tileNumbers = [];
  const pointValues = [];

  for (let i = 0; i < LEVEL_COUNT; i++) {
    tileNumbers.push(view.getUint16(off(EXE_OFFSETS.ITEM_TILE_NUMBERS) + i * 2, true));
    pointValues.push(view.getUint16(off(EXE_OFFSETS.ITEM_POINT_VALUES) + i * 2, true));
  }

  return { tileNumbers, pointValues };
}

function parseTitleScreen(data) {
  const offset = off(EXE_OFFSETS.TITLE_SCREEN_LEVEL);
  return new Uint8Array(data.slice(offset, offset + TITLE_WIDTH * TITLE_HEIGHT));
}

function parseWarpZones(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const zones = [];

  for (let i = 0; i < LEVEL_COUNT; i++) {
    zones.push({
      mapping: view.getUint16(off(EXE_OFFSETS.WARP_ZONE_MAP) + i * 2, true),
      scrollOffset: view.getUint16(off(EXE_OFFSETS.WARP_SCROLL_OFFSETS) + i * 2, true),
      startX: view.getUint16(off(EXE_OFFSETS.WARP_START_X) + i * 2, true),
    });
  }

  return zones;
}

// Write all game data back into EXE bytes
export function writeGameData(gameData) {
  const exeData = new Uint8Array(gameData.rawExe);
  const view = new DataView(exeData.buffer);
  // Restore offset delta from when this EXE was parsed
  offsetDelta = gameData._offsetDelta;

  // Write levels (path-first: path 256 bytes, tilemap 1000 bytes, padding 24 bytes)
  for (let i = 0; i < LEVEL_COUNT; i++) {
    const level = gameData.levels[i];
    const levelOffset = off(EXE_OFFSETS.LEVEL_DATA) + i * LEVEL_TOTAL_BYTES;

    exeData.set(level.pathData, levelOffset);
    exeData.set(level.tileMap, levelOffset + LEVEL_PATH_BYTES);
    exeData.set(level.padding, levelOffset + LEVEL_PATH_BYTES + LEVEL_TILE_BYTES);
  }

  // Write player starts
  for (let i = 0; i < LEVEL_COUNT; i++) {
    const start = gameData.playerStarts[i];
    exeData[off(EXE_OFFSETS.PLAYER_MOTION_FLAGS) + i] = start.motionFlag;
    view.setUint16(off(EXE_OFFSETS.PLAYER_START_X) + i * 2, start.x, true);
    view.setUint16(off(EXE_OFFSETS.PLAYER_START_Y) + i * 2, start.y, true);
  }

  // Write monsters (all levels — the EXE is patched on save to support levels 1-2)
  for (let lvl = 0; lvl < LEVEL_COUNT; lvl++) {
    const base = off(EXE_OFFSETS.MONSTER_DATA) + lvl * MONSTER_STRUCT.TOTAL_SIZE;
    for (let m = 0; m < MONSTER_STRUCT.MAX_MONSTERS; m++) {
      const mon = gameData.monsters[lvl][m];
      view.setUint16(base + m * 2, mon.enabled, true);
      view.setUint16(base + 8 + m * 2, mon.x, true);
      view.setUint16(base + 16 + m * 2, mon.y, true);
      view.setUint16(base + 24 + m * 2, mon.pathOffset, true);
      view.setInt16(base + 32 + m * 2, mon.calmness, true);
    }
  }

  // Write collectibles
  for (let i = 0; i < LEVEL_COUNT; i++) {
    view.setUint16(off(EXE_OFFSETS.ITEM_TILE_NUMBERS) + i * 2, gameData.collectibles.tileNumbers[i], true);
    view.setUint16(off(EXE_OFFSETS.ITEM_POINT_VALUES) + i * 2, gameData.collectibles.pointValues[i], true);
  }

  // Write title screen
  exeData.set(gameData.titleScreen, off(EXE_OFFSETS.TITLE_SCREEN_LEVEL));

  // Write warp zones
  for (let i = 0; i < LEVEL_COUNT; i++) {
    const wz = gameData.warpZones[i];
    view.setUint16(off(EXE_OFFSETS.WARP_ZONE_MAP) + i * 2, wz.mapping, true);
    view.setUint16(off(EXE_OFFSETS.WARP_SCROLL_OFFSETS) + i * 2, wz.scrollOffset, true);
    view.setUint16(off(EXE_OFFSETS.WARP_START_X) + i * 2, wz.startX, true);
  }

  return exeData;
}

// Get tile at (col, row) from a level's tile map
export function getTile(level, col, row) {
  if (col < 0 || col >= LEVEL_WIDTH || row < 0 || row >= LEVEL_HEIGHT) return 0;
  return level.tileMap[row * LEVEL_WIDTH + col];
}

// Set tile at (col, row) in a level's tile map
export function setTile(level, col, row, tileIndex) {
  if (col < 0 || col >= LEVEL_WIDTH || row < 0 || row >= LEVEL_HEIGHT) return;
  level.tileMap[row * LEVEL_WIDTH + col] = tileIndex;
}

// Export level set as JSON
export function exportLevelSet(gameData) {
  const exportData = {
    version: 1,
    levels: gameData.levels.map(l => ({
      pathData: Array.from(l.pathData),
      tileMap: Array.from(l.tileMap),
      padding: Array.from(l.padding),
    })),
    playerStarts: gameData.playerStarts,
    monsters: gameData.monsters,
    collectibles: gameData.collectibles,
    titleScreen: Array.from(gameData.titleScreen),
    warpZones: gameData.warpZones,
  };
  return JSON.stringify(exportData, null, 2);
}

// Import level set from JSON
export function importLevelSet(json, gameData) {
  const importData = JSON.parse(json);

  for (let i = 0; i < LEVEL_COUNT; i++) {
    if (importData.levels[i]) {
      gameData.levels[i].pathData = new Uint8Array(importData.levels[i].pathData);
      gameData.levels[i].tileMap = new Uint8Array(importData.levels[i].tileMap);
      gameData.levels[i].padding = new Uint8Array(importData.levels[i].padding);
    }
    if (importData.playerStarts[i]) {
      gameData.playerStarts[i] = importData.playerStarts[i];
    }
    if (importData.monsters[i]) {
      gameData.monsters[i] = importData.monsters[i];
    }
  }

  if (importData.collectibles) {
    gameData.collectibles = importData.collectibles;
  }
  if (importData.titleScreen) {
    gameData.titleScreen = new Uint8Array(importData.titleScreen);
  }
  if (importData.warpZones) {
    gameData.warpZones = importData.warpZones;
  }

  return gameData;
}
