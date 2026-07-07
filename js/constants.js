// Dangerous Dave - Game Constants and Data Offsets

export const EGA_PALETTE = [
  [0x00, 0x00, 0x00], // 0  Black
  [0x00, 0x00, 0xAA], // 1  Blue
  [0x00, 0xAA, 0x00], // 2  Green
  [0x00, 0xAA, 0xAA], // 3  Cyan
  [0xAA, 0x00, 0x00], // 4  Red
  [0xAA, 0x00, 0xAA], // 5  Magenta
  [0xAA, 0x55, 0x00], // 6  Brown
  [0xAA, 0xAA, 0xAA], // 7  Light Gray
  [0x55, 0x55, 0x55], // 8  Dark Gray
  [0x55, 0x55, 0xFF], // 9  Bright Blue
  [0x55, 0xFF, 0x55], // 10 Bright Green
  [0x55, 0xFF, 0xFF], // 11 Bright Cyan
  [0xFF, 0x55, 0x55], // 12 Bright Red
  [0xFF, 0x55, 0xFF], // 13 Bright Magenta
  [0xFF, 0xFF, 0x55], // 14 Bright Yellow
  [0xFF, 0xFF, 0xFF], // 15 Bright White
];

// Offsets in decompressed DAVE.EXE
export const EXE_OFFSETS = {
  CGA_TILES:           0x0C620,
  VGA_TILES:           0x120F0,
  // VGA RLE decompressor bug: MOV DI,0 should be AND DI,0Fh (3 bytes)
  VGA_RLE_BUG:         0x7EF8,
  // Monster sprite type computation: 9 copies in x86 code (3 per video mode)
  // Each video mode (CGA/EGA/VGA) has 3 copies: init, dup, respawn
  // Formula: sprite = (level - 2) * N + base  — levels 0-1 produce invalid indices
  // Patch: clamp (level - 2) to minimum 0 so levels 1-2 use base monster sprite
  //
  // CGA: (level-2)*8 + 125,  3 SHL (25/28 bytes)
  // EGA: (level-2)*16 + 197, 4 SHL (27/30 bytes)
  // VGA: (level-2)*4 + 89,   2 SHL (23/32 bytes)
  MONSTER_SPRITE_CGA_1: 0x01485,  // CGA init at level load (25 bytes)
  MONSTER_SPRITE_CGA_2: 0x050BD,  // CGA duplicate init (25 bytes)
  MONSTER_SPRITE_CGA_3: 0x02E73,  // CGA DX-based respawn (28 bytes)
  MONSTER_SPRITE_EGA_1: 0x0149E,  // EGA init at level load (27 bytes)
  MONSTER_SPRITE_EGA_2: 0x050D6,  // EGA duplicate init (27 bytes)
  MONSTER_SPRITE_EGA_3: 0x02E9B,  // EGA DX-based respawn (30 bytes)
  MONSTER_SPRITE_VGA_1: 0x014B9,  // VGA init at level load (23 bytes)
  MONSTER_SPRITE_VGA_2: 0x050F1,  // VGA duplicate init (23 bytes)
  MONSTER_SPRITE_VGA_3: 0x02EB9,  // VGA DX-based respawn (32 bytes)
  WARP_ZONE_CHECK:     0x036AE,  // Warp zone entry: mapping load + level set (17 bytes)
  // Door-solid patch: remap trophy flag [4F88h] → door tile property [5746h]
  // All 15 code references to [4F88h] are remapped inline (no code cave needed)
  TILE_PROP_DOOR:      0x259A0,  // Tile property table, door entry (word, +4 from table start)
  PC_SPEAKER_SFX:      0x1C4E0,
  MENU_FONT_CGA:       0x1D780,
  MENU_FONT_EGA:       0x1EA40,
  MENU_FONT_VGA:       0x20EC0,
  PLAYER_MOTION_FLAGS: 0x257E8,
  PLAYER_START_X:      0x257F2,
  PLAYER_START_Y:      0x25806,
  WARP_ZONE_MAP:       0x2583A,
  WARP_SCROLL_OFFSETS: 0x25862,
  WARP_START_X:        0x25876,
  ITEM_TILE_NUMBERS:   0x2590A,
  ITEM_POINT_VALUES:   0x2591E,
  MONSTER_DATA:        0x25B66,
  TITLE_SCREEN_LEVEL:  0x25EA4,
  VGA_PALETTE:         0x26B0A,
  GRADIENT_BORDER:     0x26EA9,
  LEVEL_DATA:          0x26E0A,
};

// Level structure
export const LEVEL_WIDTH = 100;
export const LEVEL_HEIGHT = 10;
export const LEVEL_TOTAL_BYTES = 1280;
export const LEVEL_PATH_BYTES = 256;
export const LEVEL_TILE_BYTES = 1000;
export const LEVEL_PADDING_BYTES = 24;
export const LEVEL_COUNT = 10;

// Tile dimensions
export const TILE_SIZE = 16;
export const VIEWPORT_WIDTH = 20;
export const VIEWPORT_HEIGHT = 10;

// Title screen
export const TITLE_WIDTH = 10;
export const TITLE_HEIGHT = 7;

// Monster config per level
export const MONSTER_STRUCT = {
  MAX_MONSTERS: 4,
  TOTAL_SIZE: 80,
};

// Tile property classifications
export const TILE_SOLID = new Set([1, 3, 5, 15, 16, 17, 18, 19, 21, 22, 23, 24, 29, 30]);
export const TILE_HAZARD = new Set([6, 25, 36]);
export const TILE_CLIMBABLE = new Set([33, 34, 35, 41]);

export const TILE_SPECIAL = {
  0: 'empty',
  2: 'exit_door',
  4: 'jetpack',
  10: 'trophy',
  20: 'gun',
};

export const TILE_COLLECTIBLE = {
  47: 100,
  48: 50,
  49: 150,
  50: 300,
  51: 200,
  52: 500,
};

// Tile names for display
export const TILE_NAMES = {
  0: 'Empty',
  1: 'Blue Brick Wall',
  2: 'Exit Door',
  3: 'Red Brick Wall',
  4: 'Jetpack',
  5: 'Brown Support',
  6: 'Fire Hazard',
  7: 'Decorative 1',
  8: 'Decorative 2',
  9: 'Decorative 3',
  10: 'Trophy',
  11: 'Decorative 4',
  12: 'Decorative 5',
  13: 'Decorative 6',
  14: 'Decorative 7',
  15: 'Gray Block',
  16: 'Purple Block',
  17: 'Green Block',
  18: 'Blue Platform',
  19: 'Gray Platform',
  20: 'Gun Pickup',
  21: 'Steel Block',
  22: 'Pipe Block',
  23: 'Rock Block',
  24: 'Dark Block',
  25: 'Water Hazard',
  26: 'Decorative 8',
  27: 'Decorative 9',
  28: 'Decorative 10',
  29: 'Red Block',
  30: 'Dirt Block',
  31: 'Decorative 11',
  32: 'Decorative 12',
  33: 'Vine',
  34: 'Ladder',
  35: 'Pipe Climb',
  36: 'Spikes',
  37: 'Decorative 13',
  38: 'Decorative 14',
  39: 'Decorative 15',
  40: 'Decorative 16',
  41: 'Tree Climb',
  42: 'Decorative 17',
  43: 'Decorative 18',
  44: 'Decorative 19',
  45: 'Decorative 20',
  46: 'Decorative 21',
  47: 'Blue Gem (100)',
  48: 'Red Ring (50)',
  49: 'Crown (150)',
  50: 'Green Gem (300)',
  51: 'Purple Gem (200)',
  52: 'Wand (500)',
};

// Number of level-building tiles
export const LEVEL_TILE_COUNT = 53; // tiles 0-52
