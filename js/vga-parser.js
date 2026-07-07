// VGA Tile Data Parser - Keen 1-3 RLE decompression/compression
// VGA tiles in the EXE are RLE-compressed; after decompression they use
// the same tileset format as EGADAVE.DAV but with 1 byte per pixel (8bpp).
import { EGA_PALETTE, EXE_OFFSETS } from './constants.js';

// Note: The space between VGA_TILES and PC_SPEAKER_SFX in the EXE is NOT
// entirely VGA data. Game code follows immediately after the compressed stream.
// Use measureVGACompressedSize() to find the actual compressed data footprint.
const VGA_TRANSPARENT = 230; // VGA sprites use color index 230 for transparency

// ---------------------------------------------------------------------------
// Patch the game's VGA RLE decompressor bug in the EXE.
//
// The x86 decompressor adjusts segment registers when DI crosses 0xFF00.
// For the source pointer (SI), it correctly uses AND SI, 0Fh.
// For the destination pointer (DI), it incorrectly uses MOV DI, 0 — losing
// the low nibble and corrupting output after position 65280.
//
// Fix: change BF 00 00 (MOV DI, 0) to 83 E7 0F (AND DI, 0Fh).
// Both instructions are exactly 3 bytes — drop-in replacement.
//
// Returns true if patched (or already patched), false if bytes don't match.
// ---------------------------------------------------------------------------
export function patchVGADecompressorBug(rawExe, offsetDelta) {
  const off = EXE_OFFSETS.VGA_RLE_BUG + offsetDelta;
  const bugBytes  = [0xBF, 0x00, 0x00]; // MOV DI, 0
  const fixBytes  = [0x83, 0xE7, 0x0F]; // AND DI, 0Fh

  // Already patched?
  if (rawExe[off] === fixBytes[0] && rawExe[off+1] === fixBytes[1] && rawExe[off+2] === fixBytes[2]) {
    return true;
  }

  // Verify original bug bytes before patching
  if (rawExe[off] !== bugBytes[0] || rawExe[off+1] !== bugBytes[1] || rawExe[off+2] !== bugBytes[2]) {
    console.error(
      `VGA decompressor patch: unexpected bytes at 0x${off.toString(16)}: ` +
      `${rawExe[off].toString(16)} ${rawExe[off+1].toString(16)} ${rawExe[off+2].toString(16)}`
    );
    return false;
  }

  rawExe[off]   = fixBytes[0];
  rawExe[off+1] = fixBytes[1];
  rawExe[off+2] = fixBytes[2];
  console.log(`VGA decompressor bug patched at 0x${off.toString(16)}: MOV DI,0 → AND DI,0Fh`);
  return true;
}

// ---------------------------------------------------------------------------
// Patch the monster sprite type computation to handle levels 1-2.
//
// The game computes monster sprite index using a formula that varies by
// video mode:  sprite = (level - 2) * N + base
//   CGA: (level-2)*8  + 125   (3 copies: init 25B, dup 25B, respawn 28B)
//   EGA: (level-2)*16 + 197   (3 copies: init 27B, dup 27B, respawn 30B)
//   VGA: (level-2)*4  + 89    (3 copies: init 23B, dup 23B, respawn 32B)
//
// For levels 0-1 the subtraction wraps negative, producing invalid sprite
// indices (jetpack Dave etc.).  Patch clamps (level-2) to min 0 so all
// video modes use the correct base monster sprite for levels 1-2.
//
// Uses 186+ SHL reg,imm8 instruction (opcode C1) for compact encoding.
// DOSBox 0.74+ always supports these instructions.
// ---------------------------------------------------------------------------
export function patchMonsterLevelClamp(rawExe, offsetDelta) {
  let patched = 0;

  function matchBytes(offset, sig) {
    for (let i = 0; i < sig.length; i++) {
      if (rawExe[offset + i] !== sig[i]) return false;
    }
    return true;
  }

  function isAlreadyPatched(offset, patch) {
    for (let i = 0; i < patch.length; i++) {
      if (rawExe[offset + i] !== patch[i]) return false;
    }
    return true;
  }

  function applyPatch(offset, sig, patch, label) {
    if (isAlreadyPatched(offset, patch)) {
      patched++;
      return true;
    }
    if (!matchBytes(offset, sig)) {
      console.warn(
        `Monster clamp ${label}: unexpected bytes at 0x${offset.toString(16)}, skipping`
      );
      return false;
    }
    for (let i = 0; i < patch.length; i++) {
      rawExe[offset + i] = patch[i];
    }
    console.log(`Monster clamp ${label}: patched at 0x${offset.toString(16)}`);
    patched++;
    return true;
  }

  // ---- CGA AX-based init & dup (25 bytes each) ----
  // Original: A1 F4 56 05 FE FF D1 E0 D1 E0 D1 E0 05 7D 00
  const sigCGA_AX = [0xA1, 0xF4, 0x56, 0x05, 0xFE, 0xFF, 0xD1, 0xE0, 0xD1, 0xE0, 0xD1, 0xE0, 0x05, 0x7D, 0x00];
  const patchCGA_AX = [
    0xA1, 0xF4, 0x56,       // MOV AX, [56F4h]
    0x48,                    // DEC AX
    0x48,                    // DEC AX
    0x79, 0x02,              // JNS +2
    0x33, 0xC0,              // XOR AX, AX
    0xC1, 0xE0, 0x03,        // SHL AX, 3  (186+)
    0x04, 0x7D,              // ADD AL, 125
    0x8B, 0xDE,              // MOV BX, SI
    0xD1, 0xE3,              // SHL BX, 1
    0x89, 0x87, 0x6A, 0x57,  // MOV [BX+576Ah], AX
    0x90,                    // NOP
    0xEB, 0x32,              // JMP +32h
  ]; // 25 bytes

  // ---- EGA AX-based init & dup (27 bytes each) ----
  // Original: A1 F4 56 05 FE FF D1 E0 D1 E0 D1 E0 D1 E0 05 C5 00
  const sigEGA_AX = [0xA1, 0xF4, 0x56, 0x05, 0xFE, 0xFF, 0xD1, 0xE0, 0xD1, 0xE0, 0xD1, 0xE0, 0xD1, 0xE0, 0x05, 0xC5, 0x00];
  const patchEGA_AX = [
    0xA1, 0xF4, 0x56,       // MOV AX, [56F4h]
    0x48,                    // DEC AX
    0x48,                    // DEC AX
    0x79, 0x02,              // JNS +2
    0x33, 0xC0,              // XOR AX, AX
    0xC1, 0xE0, 0x04,        // SHL AX, 4  (186+)
    0x05, 0xC5, 0x00,        // ADD AX, 197  (>255, can't use ADD AL)
    0x8B, 0xDE,              // MOV BX, SI
    0xD1, 0xE3,              // SHL BX, 1
    0x89, 0x87, 0x6A, 0x57,  // MOV [BX+576Ah], AX
    0x90,                    // NOP
    0x90,                    // NOP
    0xEB, 0x17,              // JMP +17h
  ]; // 27 bytes

  // ---- VGA AX-based init & dup (23 bytes each) ----
  const sigVGA_AX = [0xA1, 0xF4, 0x56, 0x05, 0xFE, 0xFF, 0xD1, 0xE0, 0xD1, 0xE0, 0x05, 0x59, 0x00];
  const patchVGA_AX = [
    0xA1, 0xF4, 0x56,       // MOV AX, [56F4h]
    0x48,                    // DEC AX
    0x48,                    // DEC AX
    0x79, 0x02,              // JNS +2
    0x33, 0xC0,              // XOR AX, AX
    0xD1, 0xE0,              // SHL AX, 1
    0xD1, 0xE0,              // SHL AX, 1
    0x04, 0x59,              // ADD AL, 89
    0x8B, 0xDE,              // MOV BX, SI
    0xD1, 0xE3,              // SHL BX, 1
    0x89, 0x87, 0x6A, 0x57,  // MOV [BX+576Ah], AX
  ]; // 23 bytes

  // ---- CGA DX-based respawn (28 bytes) ----
  const sigCGA_DX = [0x8B, 0x16, 0xF4, 0x56, 0x83, 0xC2, 0xFE, 0xD1, 0xE2, 0xD1, 0xE2, 0xD1, 0xE2, 0x03, 0xC2, 0x05, 0x7D, 0x00];
  const patchCGA_DX = [
    0x8B, 0x16, 0xF4, 0x56,  // MOV DX, [56F4h]
    0x4A,                    // DEC DX
    0x4A,                    // DEC DX
    0x79, 0x02,              // JNS +2
    0x33, 0xD2,              // XOR DX, DX
    0xC1, 0xE2, 0x03,        // SHL DX, 3  (186+)
    0x03, 0xC2,              // ADD AX, DX
    0x04, 0x7D,              // ADD AL, 125
    0x8B, 0xDE,              // MOV BX, SI
    0xD1, 0xE3,              // SHL BX, 1
    0x89, 0x87, 0x6A, 0x57,  // MOV [BX+576Ah], AX
    0x90,                    // NOP
    0xEB, 0x4A,              // JMP +4Ah
  ]; // 28 bytes

  // ---- EGA DX-based respawn (30 bytes) ----
  const sigEGA_DX = [0x8B, 0x16, 0xF4, 0x56, 0x83, 0xC2, 0xFE, 0xD1, 0xE2, 0xD1, 0xE2, 0xD1, 0xE2, 0xD1, 0xE2, 0x03, 0xC2, 0x05, 0xC5, 0x00];
  const patchEGA_DX = [
    0x8B, 0x16, 0xF4, 0x56,  // MOV DX, [56F4h]
    0x4A,                    // DEC DX
    0x4A,                    // DEC DX
    0x79, 0x02,              // JNS +2
    0x33, 0xD2,              // XOR DX, DX
    0xC1, 0xE2, 0x04,        // SHL DX, 4  (186+)
    0x03, 0xC2,              // ADD AX, DX
    0x05, 0xC5, 0x00,        // ADD AX, 197
    0x8B, 0xDE,              // MOV BX, SI
    0xD1, 0xE3,              // SHL BX, 1
    0x89, 0x87, 0x6A, 0x57,  // MOV [BX+576Ah], AX
    0x90,                    // NOP
    0x90,                    // NOP
    0xEB, 0x20,              // JMP +20h
  ]; // 30 bytes

  // ---- VGA DX-based respawn (32 bytes) ----
  const sigVGA_DX = [0x8B, 0xDE, 0xD1, 0xE3, 0x8B, 0x87, 0x7A, 0x57, 0x8B, 0x16, 0xF4, 0x56, 0x83, 0xC2, 0xFE];
  const patchVGA_DX = [
    0x8B, 0xDE,              // MOV BX, SI
    0xD1, 0xE3,              // SHL BX, 1
    0x8B, 0x87, 0x7A, 0x57,  // MOV AX, [BX+577Ah]
    0x8B, 0x16, 0xF4, 0x56,  // MOV DX, [56F4h]
    0x4A,                    // DEC DX
    0x4A,                    // DEC DX
    0x79, 0x02,              // JNS +2
    0x33, 0xD2,              // XOR DX, DX
    0xD1, 0xE2,              // SHL DX, 1
    0xD1, 0xE2,              // SHL DX, 1
    0x03, 0xC2,              // ADD AX, DX
    0x04, 0x59,              // ADD AL, 89
    0x89, 0x87, 0x6A, 0x57,  // MOV [BX+576Ah], AX
    0x90,                    // NOP
    0x90,                    // NOP
  ]; // 32 bytes

  // Apply all 9 patches (3 per video mode)
  applyPatch(EXE_OFFSETS.MONSTER_SPRITE_CGA_1 + offsetDelta, sigCGA_AX, patchCGA_AX, 'CGA init');
  applyPatch(EXE_OFFSETS.MONSTER_SPRITE_CGA_2 + offsetDelta, sigCGA_AX, patchCGA_AX, 'CGA dup');
  applyPatch(EXE_OFFSETS.MONSTER_SPRITE_CGA_3 + offsetDelta, sigCGA_DX, patchCGA_DX, 'CGA respawn');
  applyPatch(EXE_OFFSETS.MONSTER_SPRITE_EGA_1 + offsetDelta, sigEGA_AX, patchEGA_AX, 'EGA init');
  applyPatch(EXE_OFFSETS.MONSTER_SPRITE_EGA_2 + offsetDelta, sigEGA_AX, patchEGA_AX, 'EGA dup');
  applyPatch(EXE_OFFSETS.MONSTER_SPRITE_EGA_3 + offsetDelta, sigEGA_DX, patchEGA_DX, 'EGA respawn');
  applyPatch(EXE_OFFSETS.MONSTER_SPRITE_VGA_1 + offsetDelta, sigVGA_AX, patchVGA_AX, 'VGA init');
  applyPatch(EXE_OFFSETS.MONSTER_SPRITE_VGA_2 + offsetDelta, sigVGA_AX, patchVGA_AX, 'VGA dup');
  applyPatch(EXE_OFFSETS.MONSTER_SPRITE_VGA_3 + offsetDelta, sigVGA_DX, patchVGA_DX, 'VGA respawn');

  return patched;
}

// ---------------------------------------------------------------------------
// Patch the warp zone entry code to guard against mapping=0.
//
// The game enters "warp zone mode" when Dave goes off the top of the screen.
// It loads the destination level from a mapping table: new_level = mapping[level] - 1.
// For levels without a warp zone (mapping=0), this produces 0xFFFF (-1), which
// wraps the level data offset (0xFFFF * 0x500 = 0xFB00) to garbage data.
// This is the "level 6 glitch" documented by Jonathan Bar Or.
//
// Fix: Remove a redundant BX reload (6 bytes) and insert TEST AX,AX / JZ
// to skip the warp if mapping is 0. The JZ jumps to the function epilogue.
//
// Returns true if patched (or already patched), false if bytes don't match.
// ---------------------------------------------------------------------------
export function patchWarpZoneCheck(rawExe, offsetDelta) {
  const off = EXE_OFFSETS.WARP_ZONE_CHECK + offsetDelta;

  // Original 17 bytes:
  //   8B 1E F4 56   MOV BX, [56F4h]      (redundant reload)
  //   D1 E3         SHL BX, 1             (redundant)
  //   8B 87 6A 01   MOV AX, [BX+016Ah]   mapping[level]
  //   48            DEC AX                mapping - 1
  //   A3 F4 56      MOV [56F4h], AX       store new level
  //   E8 AA 17      CALL load_level
  const sig = [
    0x8B, 0x1E, 0xF4, 0x56,
    0xD1, 0xE3,
    0x8B, 0x87, 0x6A, 0x01,
    0x48,
    0xA3, 0xF4, 0x56,
    0xE8, 0xAA, 0x17,
  ];

  // Patched 17 bytes:
  //   8B 87 6A 01   MOV AX, [BX+016Ah]   mapping[level] (BX already set)
  //   85 C0         TEST AX, AX           mapping == 0?
  //   74 63         JZ +0x63              skip warp → epilogue
  //   48            DEC AX                mapping - 1
  //   A3 F4 56      MOV [56F4h], AX       store new level
  //   E8 AC 17      CALL load_level       (displacement adjusted +2)
  //   90 90         NOP NOP               padding
  const patch = [
    0x8B, 0x87, 0x6A, 0x01,
    0x85, 0xC0,
    0x74, 0x63,
    0x48,
    0xA3, 0xF4, 0x56,
    0xE8, 0xAC, 0x17,
    0x90, 0x90,
  ];

  // Already patched?
  let alreadyPatched = true;
  for (let i = 0; i < patch.length; i++) {
    if (rawExe[off + i] !== patch[i]) { alreadyPatched = false; break; }
  }
  if (alreadyPatched) return true;

  // Verify original signature
  for (let i = 0; i < sig.length; i++) {
    if (rawExe[off + i] !== sig[i]) {
      console.warn(
        `Warp zone check patch: unexpected bytes at 0x${off.toString(16)}, skipping`
      );
      return false;
    }
  }

  // Apply patch
  for (let i = 0; i < patch.length; i++) {
    rawExe[off + i] = patch[i];
  }
  console.log(`Warp zone check patched at 0x${off.toString(16)}: mapping=0 now skips warp`);
  return true;
}

// ---------------------------------------------------------------------------
// Patch door tiles to be solid until the trophy is collected.
//
// The game's tile property table (53 words at DS:02CCh) has door (tile 2)
// at DS:02D0h with value 0 (passable). The trophy flag lives at [4F88h].
//
// NOTE: DS:5742h (used by 8 CMP [BX+5742h] sites) is a 4-slot monster/
// sprite active-flags array in BSS — NOT the tile property table.
// The actual tile collision reads from [BX+02CCh] (file offset 0x2582C).
//
// Strategy: keep [4F88h] working normally for all CMP checks (guards, door
// handlers, HUD). Only ADD writes to [02D0h] at the two mutation points:
//
//  Trophy SET (4 copies, one per video mode):
//    Original 17 bytes: MOV [4F88h],1; MOV AX,7; PUSH AX; CALL snd; INC SP×2; XOR SI,SI
//    Patched  17 bytes: MOV [4F88h],1; MOV [02D0h],0; XOR SI,SI; NOP×3
//    (sacrifices trophy pickup sound to free 11 bytes for the door write)
//
//  Level INIT (1 site):
//    Original 12 bytes: MOV [4F88h],0; MOV [4F84h],0
//    Patched  12 bytes: XOR AX,AX; MOV [4F84h],AX; MOV [4F88h],AX; INC AX; MOV [02D0h],AX
//    (compact encoding: zeros both flags via AX, then sets door=solid)
//
// Total: 5 code sites + 1 data change. All CMP sites are untouched.
// ---------------------------------------------------------------------------
export function patchDoorSolid(rawExe, offsetDelta) {
  // --- Ref offsets (512-byte header convention) ---
  // Each points to the 2 address bytes (88 4F) inside the instruction.

  // 10 CMP sites — we revert any previous remap but do NOT modify them
  const cmpRefs = [
    [0x040F4, 0x83, 0x3E],  // trophy guard (×4 video modes)
    [0x04280, 0x83, 0x3E],
    [0x0440D, 0x83, 0x3E],
    [0x0459B, 0x83, 0x3E],
    [0x0415E, 0x83, 0x3E],  // door handler (×4)
    [0x042EA, 0x83, 0x3E],
    [0x04477, 0x83, 0x3E],
    [0x04605, 0x83, 0x3E],
    [0x00C0A, 0x83, 0x3E],  // HUD trophy draw
    [0x03651, 0x83, 0x3E],  // in-level trophy draw
  ];

  // 4 trophy SET sites: MOV [4F88h], 1 — we add MOV [5746h],0 after them
  const setRefs = [0x040FB, 0x04287, 0x04414, 0x045A2];

  // 1 level init site: MOV [4F88h], 0; MOV [4F84h], 0
  const initRef = 0x0518B;

  // ---- Phase 1: revert any previous remap (old v1 approach) ----
  for (const [ref, expOp, expMod] of cmpRefs) {
    const off = ref + offsetDelta;
    if (rawExe[off] === 0x46 && rawExe[off + 1] === 0x57 &&
        rawExe[off - 2] === expOp && rawExe[off - 1] === expMod) {
      rawExe[off] = 0x88;
      rawExe[off + 1] = 0x4F;
      rawExe[off + 2] = rawExe[off + 2] === 0x00 ? 0x01 : 0x00;
    }
  }
  for (const ref of setRefs) {
    const off = ref + offsetDelta;
    if (rawExe[off] === 0x46 && rawExe[off + 1] === 0x57 &&
        rawExe[off - 2] === 0xC7 && rawExe[off - 1] === 0x06) {
      rawExe[off] = 0x88;
      rawExe[off + 1] = 0x4F;
      rawExe[off + 2] = rawExe[off + 2] === 0x00 ? 0x01 : 0x00;
      rawExe[off + 3] = 0x00;
    }
  }
  {
    const off = initRef + offsetDelta;
    if (rawExe[off] === 0x46 && rawExe[off + 1] === 0x57 &&
        rawExe[off - 2] === 0xC7 && rawExe[off - 1] === 0x06) {
      rawExe[off] = 0x88;
      rawExe[off + 1] = 0x4F;
      rawExe[off + 2] = rawExe[off + 2] === 0x00 ? 0x01 : 0x00;
      rawExe[off + 3] = 0x00;
    }
  }

  // ---- Phase 2: set door tile property to solid (1) ----
  const tilePropDoorOff = EXE_OFFSETS.TILE_PROP_DOOR + offsetDelta;
  rawExe[tilePropDoorOff]     = 0x01;
  rawExe[tilePropDoorOff + 1] = 0x00;

  // ---- Phase 3: patch 4 trophy SET sites ----
  // We keep the original MOV [4F88h],1 (6 bytes) and overwrite the next 11
  // bytes (sound-effect call + XOR SI,SI) with:
  //   C7 06 D0 02 00 00   MOV word ptr [02D0h], 0  (door tile prop = passable)
  //   33 F6               XOR SI, SI               (preserve original clear)
  //   90 90 90            NOP × 3
  const setInline = [0xC7, 0x06, 0xD0, 0x02, 0x00, 0x00, 0x33, 0xF6, 0x90, 0x90, 0x90];
  let patched = 0;

  for (const ref of setRefs) {
    const off = ref + offsetDelta;

    // Verify original MOV [4F88h], 1
    if (rawExe[off - 2] !== 0xC7 || rawExe[off - 1] !== 0x06 ||
        rawExe[off] !== 0x88 || rawExe[off + 1] !== 0x4F ||
        rawExe[off + 2] !== 0x01 || rawExe[off + 3] !== 0x00) {
      console.warn(`Door-solid: SET ref 0x${ref.toString(16)} unexpected bytes, skipping`);
      continue;
    }

    // Already patched with correct address (02D0h)?
    if (rawExe[off + 4] === 0xC7 && rawExe[off + 6] === 0xD0 &&
        rawExe[off + 7] === 0x02) {
      patched++;
      continue;
    }

    // Previously patched with wrong address (5746h)? Fix it.
    if (rawExe[off + 4] === 0xC7 && rawExe[off + 6] === 0x46 &&
        rawExe[off + 7] === 0x57) {
      rawExe[off + 6] = 0xD0;
      rawExe[off + 7] = 0x02;
      patched++;
      continue;
    }

    // Verify sound-effect code follows (B8 = MOV AX,imm16)
    if (rawExe[off + 4] !== 0xB8) {
      console.warn(`Door-solid: expected B8 after SET at 0x${ref.toString(16)}, skipping`);
      continue;
    }

    // Write inline patch (11 bytes at off+4 .. off+14)
    for (let i = 0; i < setInline.length; i++) {
      rawExe[off + 4 + i] = setInline[i];
    }
    patched++;
  }

  // ---- Phase 4: patch level init ----
  // Original 12 bytes (at off-2):
  //   C7 06 88 4F 00 00   MOV word ptr [4F88h], 0
  //   C7 06 84 4F 00 00   MOV word ptr [4F84h], 0
  //
  // New 12 bytes — compact sequence using AX:
  //   33 C0               XOR AX, AX          (AX = 0)
  //   A3 84 4F            MOV [4F84h], AX      (reset game flag)
  //   A3 88 4F            MOV [4F88h], AX      (reset trophy flag)
  //   40                  INC AX               (AX = 1)
  //   A3 D0 02            MOV [02D0h], AX      (door tile prop = solid)
  const initPatch = [0x33, 0xC0, 0xA3, 0x84, 0x4F, 0xA3, 0x88, 0x4F, 0x40, 0xA3, 0xD0, 0x02];
  {
    const off = initRef + offsetDelta;

    // Already patched with correct address?
    if (rawExe[off - 2] === 0x33 && rawExe[off - 1] === 0xC0 &&
        rawExe[off + 8] === 0xD0 && rawExe[off + 9] === 0x02) {
      patched++;
    }
    // Previously patched with wrong address (5746h)? Fix it.
    else if (rawExe[off - 2] === 0x33 && rawExe[off - 1] === 0xC0 &&
             rawExe[off + 8] === 0x46 && rawExe[off + 9] === 0x57) {
      rawExe[off + 8] = 0xD0;
      rawExe[off + 9] = 0x02;
      patched++;
    }
    // Original? (two consecutive MOV word ptr [imm16], 0)
    else if (rawExe[off - 2] === 0xC7 && rawExe[off - 1] === 0x06 &&
             rawExe[off] === 0x88 && rawExe[off + 1] === 0x4F &&
             rawExe[off + 4] === 0xC7 && rawExe[off + 5] === 0x06 &&
             rawExe[off + 6] === 0x84 && rawExe[off + 7] === 0x4F) {
      for (let i = 0; i < initPatch.length; i++) {
        rawExe[off - 2 + i] = initPatch[i];
      }
      patched++;
    } else {
      console.warn('Door-solid: INIT site has unexpected bytes');
    }
  }

  console.log(`Door-solid patch: ${patched}/5 sites patched, door tile set to solid`);
  return patched === 5;
}

// ---------------------------------------------------------------------------
// Parse 256-color VGA palette from EXE (768 bytes of 6-bit RGB at VGA_PALETTE)
// Returns array of 256 [r,g,b] triplets scaled to 0-255 range
// ---------------------------------------------------------------------------
let _cachedVGAPalette = null;

export function parseVGAPalette(rawExe, offsetDelta) {
  if (_cachedVGAPalette) return _cachedVGAPalette;
  const palOffset = EXE_OFFSETS.VGA_PALETTE + offsetDelta;
  const palette = [];
  for (let i = 0; i < 256; i++) {
    const r6 = rawExe[palOffset + i * 3];
    const g6 = rawExe[palOffset + i * 3 + 1];
    const b6 = rawExe[palOffset + i * 3 + 2];
    // Scale 6-bit (0-63) to 8-bit (0-255): val * 255 / 63
    palette.push([
      Math.round(r6 * 255 / 63),
      Math.round(g6 * 255 / 63),
      Math.round(b6 * 255 / 63),
    ]);
  }
  _cachedVGAPalette = palette;
  return palette;
}

export function getVGAPalette() {
  return _cachedVGAPalette;
}

// ---------------------------------------------------------------------------
// Keen 1-3 RLE Decompression
// First 4 bytes = UINT32LE decompressed size, then compressed payload.
// Control byte >= 128 → literal run of (control - 127) bytes
// Control byte <  128 → RLE run: repeat next byte (control + 3) times
// ---------------------------------------------------------------------------
export function decompressKeenRLE(data, offset) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decompressedSize = view.getUint32(offset, true);
  const output = new Uint8Array(decompressedSize);
  let src = offset + 4;
  let dst = 0;

  while (dst < decompressedSize && src < data.length) {
    const control = data[src++];
    if (control >= 128) {
      // Literal run
      const count = control - 127;
      for (let i = 0; i < count && dst < decompressedSize && src < data.length; i++) {
        output[dst++] = data[src++];
      }
    } else {
      // RLE run
      const count = control + 3;
      if (src >= data.length) break;
      const value = data[src++];
      for (let i = 0; i < count && dst < decompressedSize; i++) {
        output[dst++] = value;
      }
    }
  }

  return output;
}

// ---------------------------------------------------------------------------
// Keen 1-3 RLE Compression
// ---------------------------------------------------------------------------
export function compressKeenRLE(data) {
  const out = [];

  // 4-byte decompressed size header (UINT32LE)
  out.push(data.length & 0xFF);
  out.push((data.length >> 8) & 0xFF);
  out.push((data.length >> 16) & 0xFF);
  out.push((data.length >> 24) & 0xFF);

  let pos = 0;
  while (pos < data.length) {
    // Check for an RLE run (3+ identical bytes)
    let runLen = 1;
    while (pos + runLen < data.length &&
           data[pos + runLen] === data[pos] &&
           runLen < 130) {
      runLen++;
    }

    if (runLen >= 3) {
      // Encode as RLE: control = runLen-3 (0..127), then repeated byte
      out.push(runLen - 3);
      out.push(data[pos]);
      pos += runLen;
    } else {
      // Collect literal bytes (up to 127 — NOT 128!)
      // The game's x86 decompressor sign-extends the literal count byte via CBW.
      // A count of 128 (0x80) wraps to -128/65408, causing massive buffer overrun.
      // The original compressor never exceeds 127-byte literals (max control byte 254).
      const litStart = pos;
      let litLen = 0;

      while (litLen < 127 && pos < data.length) {
        // Look ahead: would starting RLE here be better?
        let ahead = 1;
        while (pos + ahead < data.length &&
               data[pos + ahead] === data[pos] &&
               ahead < 3) {
          ahead++;
        }
        if (ahead >= 3) break; // switch to RLE on next iteration
        pos++;
        litLen++;
      }

      if (litLen > 0) {
        out.push(litLen + 127); // control = 128..255
        for (let i = 0; i < litLen; i++) {
          out.push(data[litStart + i]);
        }
      }
    }
  }

  return new Uint8Array(out);
}

// ---------------------------------------------------------------------------
// Parse VGA tileset from decompressed data
// Same structure as EGADAVE.DAV: UINT32LE count, UINT32LE[count] offsets, data
// VGA tiles are 1 byte per pixel; 16x16 headerless tiles = 256 bytes each
// ---------------------------------------------------------------------------
export function parseVGATileset(decompressedData) {
  const view = new DataView(
    decompressedData.buffer,
    decompressedData.byteOffset,
    decompressedData.byteLength,
  );
  const tileCount = view.getUint32(0, true);

  if (tileCount === 0 || tileCount > 1000) {
    throw new Error(`Invalid VGA tile count: ${tileCount}`);
  }

  const offsets = [];
  for (let i = 0; i < tileCount; i++) {
    offsets.push(view.getUint32(4 + i * 4, true));
  }

  const tiles = [];
  for (let i = 0; i < tileCount; i++) {
    const offset = offsets[i];
    const nextOffset = (i + 1 < tileCount) ? offsets[i + 1] : decompressedData.length;
    const size = nextOffset - offset;

    let width, height, hasHeader, dataStart;

    // VGA 16x16 tile: 16*16*1 = 256 bytes, no header
    if (size === 256) {
      width = 16;
      height = 16;
      hasHeader = false;
      dataStart = offset;
    } else {
      // Variable-size sprite with 4-byte header (width LE16, height LE16)
      width = view.getUint16(offset, true);
      height = view.getUint16(offset + 2, true);
      hasHeader = true;
      dataStart = offset + 4;

      if (width === 0 || height === 0 || width > 512 || height > 512) {
        width = 16;
        height = 16;
        hasHeader = false;
        dataStart = offset;
      }
    }

    tiles.push({ index: i, width, height, offset, size, hasHeader, dataStart });
  }

  return tiles;
}

// ---------------------------------------------------------------------------
// Convert a VGA tile to an offscreen canvas for display.
// opaque=true  → all pixels fully opaque  (for level tiles / palette)
// opaque=false → color 230 is transparent (for character sprites)
// ---------------------------------------------------------------------------
export function vgaTileToCanvas(vgaTileset, vgaDecompressed, vgaPalette, tileIndex, opaque) {
  const meta = vgaTileset[tileIndex];
  if (!meta) return null;
  const w = meta.width;
  const h = meta.height;
  const cvs = document.createElement('canvas');
  cvs.width = w;
  cvs.height = h;
  const imgData = new ImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const srcIdx = meta.dataStart + y * w + x;
      const palIdx = vgaDecompressed[srcIdx];
      const [r, g, b] = vgaPalette[palIdx] || [0, 0, 0];
      const dstIdx = (y * w + x) * 4;
      imgData.data[dstIdx]     = r;
      imgData.data[dstIdx + 1] = g;
      imgData.data[dstIdx + 2] = b;
      imgData.data[dstIdx + 3] = (!opaque && palIdx === VGA_TRANSPARENT) ? 0 : 255;
    }
  }
  cvs.getContext('2d').putImageData(imgData, 0, 0);
  return cvs;
}

// ---------------------------------------------------------------------------
// Encode RGBA ImageData → VGA byte-per-pixel (EGA color indices 0-15,
// with 230 for transparent pixels)
// ---------------------------------------------------------------------------
export function encodeVGATile(imageData, width, height) {
  const result = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixOff = (y * width + x) * 4;
      const r = imageData.data[pixOff];
      const g = imageData.data[pixOff + 1];
      const b = imageData.data[pixOff + 2];
      const a = imageData.data[pixOff + 3];

      if (a === 0) {
        // Transparent pixel → VGA transparency index
        result[y * width + x] = VGA_TRANSPARENT;
      } else {
        result[y * width + x] = findClosestEGAColor(r, g, b);
      }
    }
  }

  return result;
}

function findClosestEGAColor(r, g, b) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < 16; i++) {
    const c = EGA_PALETTE[i];
    const dr = r - c[0], dg = g - c[1], db = b - c[2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Measure the original VGA compressed stream size (bytes consumed by the
// decompressor). Game code/data immediately follows the compressed data
// within the EXE — we must NEVER overwrite or zero-fill past it.
// ---------------------------------------------------------------------------
export function measureVGACompressedSize(rawExe, offsetDelta) {
  const vgaOffset = EXE_OFFSETS.VGA_TILES + offsetDelta;
  const view = new DataView(rawExe.buffer, rawExe.byteOffset, rawExe.byteLength);
  const decompressedSize = view.getUint32(vgaOffset, true);

  let src = vgaOffset + 4;
  let dst = 0;
  while (dst < decompressedSize && src < rawExe.length) {
    const control = rawExe[src++];
    if (control >= 128) {
      const count = control - 127;
      for (let i = 0; i < count && dst < decompressedSize && src < rawExe.length; i++) {
        src++; dst++;
      }
    } else {
      const count = control + 3;
      if (src >= rawExe.length) break;
      src++;
      dst += Math.min(count, decompressedSize - dst);
    }
  }
  return src - vgaOffset;
}

// ---------------------------------------------------------------------------
// Write re-compressed VGA data back into the EXE byte array.
//
// IMPORTANT: The space between VGA_TILES and PC_SPEAKER_SFX is NOT entirely
// VGA compressed data. Game code immediately follows the compressed stream.
// We must only overwrite within the original compressed data's footprint —
// NEVER zero-fill or write past it, or we destroy game code.
//
// Returns { ok: bool }
// ---------------------------------------------------------------------------
export function writeVGAToExe(rawExe, vgaDecompressed, offsetDelta, originalCompressedSize) {
  const compressed = compressKeenRLE(vgaDecompressed);
  const vgaOffset = EXE_OFFSETS.VGA_TILES + offsetDelta;

  if (compressed.length > originalCompressedSize) {
    console.error(
      `VGA compressed (${compressed.length}) exceeds original space (${originalCompressedSize})!`
    );
    return { ok: false };
  }

  // Write compressed data (fits within the original footprint)
  for (let i = 0; i < compressed.length; i++) {
    rawExe[vgaOffset + i] = compressed[i];
  }

  // DO NOT zero-fill — bytes after the compressed stream are game code.
  // Old compressed bytes between [compressed.length, originalCompressedSize)
  // are dead data that the decompressor will never reach (output buffer full).

  console.log(
    `VGA written: ${compressed.length} bytes ` +
    `(original: ${originalCompressedSize}, saved ${originalCompressedSize - compressed.length} bytes)`
  );

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Surgical VGA write: rebuild the compressed stream chunk-by-chunk, modifying
// only the bytes that changed while preserving the exact chunk structure near
// the 64KB segment boundary.
//
// The game's x86 RLE decompressor has a bug: when DI (destination offset)
// reaches 0xFF00, it adjusts the segment register with MOV DI,0 instead of
// AND DI,0Fh — losing the low nibble. The original data was designed around
// this 1-byte loss. Full recompression changes chunk sizes, moving the DI
// value at the boundary from 0xFF01 (loses 1 byte) to 0xFF0A (loses 10),
// corrupting all VGA tile data after position 65280.
//
// This function avoids the problem by walking the original compressed stream
// and rebuilding it with targeted modifications:
//
//   1. Unchanged chunks → copied verbatim (no size change)
//   2. Literal chunks with changed bytes → byte values swapped (no size change)
//   3. RLE chunks where all output bytes are the same value → value byte swapped
//   4. RLE chunks with mixed changes, SAFELY BELOW the boundary → re-encoded
//      as optimal RLE/literal mix (may change size, but can't affect boundary)
//   5. RLE chunks with mixed changes NEAR the boundary → kept as-is (conflict)
//
// Parameters:
//   rawExe               - mutable EXE byte array (modified in place)
//   originalCompressed   - Uint8Array snapshot of original compressed VGA data
//   originalDecompressed - Uint8Array snapshot of decompressed VGA before edits
//   newDecompressed      - Uint8Array of current (edited) decompressed VGA data
//   offsetDelta          - MZ header offset delta
//
// Returns { ok, changesApplied, rleConflicts }
// ---------------------------------------------------------------------------
export function surgicalWriteVGA(
  rawExe, originalCompressed, originalDecompressed, newDecompressed, offsetDelta
) {
  // 1. Build set of changed decompressed byte offsets
  const changed = new Set();
  for (let i = 0; i < originalDecompressed.length; i++) {
    if (originalDecompressed[i] !== newDecompressed[i]) changed.add(i);
  }

  if (changed.size === 0) {
    console.log('surgicalWriteVGA: no changes detected');
    return { ok: true, changesApplied: 0, rleConflicts: 0 };
  }

  // The game's decompressor checks DI >= 0xFF00 between chunks. Splitting an
  // RLE chunk into sub-chunks adds new check points. This is safe as long as
  // the sub-chunks are entirely below the boundary zone. 256-byte margin.
  const BOUNDARY_SAFE_LIMIT = 0xFE00;

  // Two-pass strategy:
  //   Pass 1: Try with RLE splitting (best quality — handles all changes)
  //   Pass 2: If pass 1 exceeds space, fall back to simple mode (literal +
  //           RLE value swaps only; mixed RLE runs become conflicts)
  //
  // RLE splitting can expand the compressed data because a 2-byte RLE chunk
  // may become multiple literal/RLE sub-chunks. If edits touch many large
  // RLE runs, the growth can exceed the available space.

  // Three-pass strategy:
  //   Pass 1: RLE splitting (best quality, may grow compressed output)
  //   Pass 2: Hybrid — fully re-encode safe zone, surgical boundary zone
  //   Pass 3: Simple — no splits, byte swaps only (never grows, but has conflicts)

  // --- Pass 1: try with RLE splitting ---
  const splitResult = rebuildCompressedStream(
    originalCompressed, newDecompressed, changed,
    BOUNDARY_SAFE_LIMIT, true
  );

  if (splitResult.out.length <= originalCompressed.length) {
    const vgaOffset = EXE_OFFSETS.VGA_TILES + offsetDelta;
    for (let i = 0; i < splitResult.out.length; i++) {
      rawExe[vgaOffset + i] = splitResult.out[i];
    }
    console.log(
      `surgicalWriteVGA [split]: ${splitResult.literalSwaps} literal, ` +
      `${splitResult.rleValueSwaps} RLE value, ${splitResult.rleSplits} RLE split, ` +
      `${splitResult.rleConflicts} conflict ` +
      `(${changed.size} changed, ${splitResult.out.length}/${originalCompressed.length} bytes)`
    );
    return {
      ok: true,
      changesApplied: splitResult.literalSwaps + splitResult.rleValueSwaps + splitResult.rleSplits,
      rleConflicts: splitResult.rleConflicts,
    };
  }

  console.log(
    `surgicalWriteVGA: split mode grew to ${splitResult.out.length} bytes ` +
    `(limit ${originalCompressed.length}) — trying hybrid mode`
  );

  // --- Pass 2: Hybrid — re-encode safe zone optimally, surgical boundary ---
  const hybridResult = hybridCompressStream(
    originalCompressed, newDecompressed, changed, BOUNDARY_SAFE_LIMIT
  );

  if (hybridResult && hybridResult.out.length <= originalCompressed.length) {
    const vgaOffset = EXE_OFFSETS.VGA_TILES + offsetDelta;
    for (let i = 0; i < hybridResult.out.length; i++) {
      rawExe[vgaOffset + i] = hybridResult.out[i];
    }
    console.log(
      `surgicalWriteVGA [hybrid]: safe zone re-encoded, ` +
      `${hybridResult.rleConflicts} boundary conflict ` +
      `(${changed.size} changed, ${hybridResult.out.length}/${originalCompressed.length} bytes)`
    );
    return {
      ok: true,
      changesApplied: changed.size - hybridResult.rleConflicts,
      rleConflicts: hybridResult.rleConflicts,
    };
  }

  console.log(
    `surgicalWriteVGA: hybrid mode ${hybridResult ? `grew to ${hybridResult.out.length}` : 'failed'} — falling back to simple mode`
  );

  // --- Pass 3: Simple — no splits, byte swaps only ---
  const simpleResult = rebuildCompressedStream(
    originalCompressed, newDecompressed, changed,
    BOUNDARY_SAFE_LIMIT, false
  );

  if (simpleResult.out.length <= originalCompressed.length) {
    const vgaOffset = EXE_OFFSETS.VGA_TILES + offsetDelta;
    for (let i = 0; i < simpleResult.out.length; i++) {
      rawExe[vgaOffset + i] = simpleResult.out[i];
    }
    console.log(
      `surgicalWriteVGA [simple]: ${simpleResult.literalSwaps} literal, ` +
      `${simpleResult.rleValueSwaps} RLE value, ${simpleResult.rleConflicts} conflict ` +
      `(${changed.size} changed, ${simpleResult.out.length}/${originalCompressed.length} bytes)`
    );
    return {
      ok: true,
      changesApplied: simpleResult.literalSwaps + simpleResult.rleValueSwaps,
      rleConflicts: simpleResult.rleConflicts,
    };
  }

  console.error('surgicalWriteVGA: all passes failed');
  return { ok: false, changesApplied: 0, rleConflicts: -1 };
}

// ---------------------------------------------------------------------------
// Rebuild the compressed stream with surgical modifications.
//
// If allowSplits=true, RLE runs with mixed changes (below the segment
// boundary) are re-encoded as optimal literal/RLE sub-chunks. This gives
// the best edit coverage but may increase compressed size.
//
// If allowSplits=false, mixed RLE runs are kept as-is (reported as
// conflicts). This never changes the compressed size.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Hybrid compression: fully re-encode the safe zone (< boundarySafeLimit)
// using optimal compression, then surgically preserve the boundary zone's
// chunk structure. This trades flexibility in the safe zone (where chunk
// boundaries don't matter) for strict preservation near the 64KB boundary.
// ---------------------------------------------------------------------------
function hybridCompressStream(
  originalCompressed, newDecompressed, changed, boundarySafeLimit
) {
  const view = new DataView(
    originalCompressed.buffer, originalCompressed.byteOffset,
    originalCompressed.byteLength
  );
  const decompSize = view.getUint32(0, true);

  // Step 1: Walk original stream to find where boundary zone starts
  let src = 4, dst = 0;
  let boundaryCompSrc = -1;
  let boundaryDecompDst = -1;

  while (dst < decompSize && src < originalCompressed.length) {
    const control = originalCompressed[src];
    let chunkDecompSize;

    if (control >= 128) {
      chunkDecompSize = control - 127;
    } else {
      chunkDecompSize = control + 3;
    }

    // If this chunk's output would cross into boundary zone, stop here
    if (dst + chunkDecompSize > boundarySafeLimit) {
      boundaryCompSrc = src;
      boundaryDecompDst = dst;
      break;
    }

    // Skip past this chunk in the compressed stream
    if (control >= 128) {
      src += 1 + (control - 127); // control + literal bytes
      dst += control - 127;
    } else {
      src += 2; // control + value
      dst += Math.min(control + 3, decompSize - dst);
    }
  }

  // If no boundary reached, all data is in safe zone
  if (boundaryCompSrc < 0) {
    boundaryCompSrc = src;
    boundaryDecompDst = dst;
  }

  // Step 2: Re-encode safe zone optimally from new decompressed data
  const out = [];
  // Copy 4-byte header verbatim
  for (let i = 0; i < 4; i++) out.push(originalCompressed[i]);

  // Compress safe zone bytes using optimal RLE
  encodeRunToStream(newDecompressed, 0, boundaryDecompDst, out);

  // Step 3: Copy boundary zone from original with surgical byte swaps
  let bSrc = boundaryCompSrc;
  let bDst = boundaryDecompDst;
  let rleConflicts = 0;

  while (bDst < decompSize && bSrc < originalCompressed.length) {
    const control = originalCompressed[bSrc++];

    if (control >= 128) {
      // Literal chunk: swap changed bytes
      const count = control - 127;
      out.push(control);
      for (let i = 0; i < count && bDst < decompSize && bSrc < originalCompressed.length; i++) {
        if (changed.has(bDst)) {
          out.push(newDecompressed[bDst]);
        } else {
          out.push(originalCompressed[bSrc]);
        }
        bSrc++;
        bDst++;
      }
    } else {
      // RLE chunk
      const count = control + 3;
      if (bSrc >= originalCompressed.length) break;
      const origValue = originalCompressed[bSrc++];
      const written = Math.min(count, decompSize - bDst);

      let hasChanges = false;
      for (let i = 0; i < written; i++) {
        if (changed.has(bDst + i)) { hasChanges = true; break; }
      }

      if (!hasChanges) {
        out.push(control);
        out.push(origValue);
      } else {
        // Check if all new values are the same
        let allSame = true;
        const targetValue = newDecompressed[bDst];
        for (let i = 1; i < written; i++) {
          if (newDecompressed[bDst + i] !== targetValue) {
            allSame = false;
            break;
          }
        }

        if (allSame) {
          out.push(control);
          out.push(targetValue);
        } else {
          // Boundary conflict — keep original
          out.push(control);
          out.push(origValue);
          rleConflicts++;
        }
      }

      bDst += written;
    }
  }

  return { out, rleConflicts };
}

function rebuildCompressedStream(
  originalCompressed, newDecompressed, changed, boundarySafeLimit, allowSplits
) {
  const view = new DataView(
    originalCompressed.buffer, originalCompressed.byteOffset,
    originalCompressed.byteLength
  );
  const decompSize = view.getUint32(0, true);
  const out = [];

  // Copy 4-byte decompressed size header verbatim
  for (let i = 0; i < 4; i++) out.push(originalCompressed[i]);

  let src = 4;
  let dst = 0;
  let literalSwaps = 0;
  let rleValueSwaps = 0;
  let rleSplits = 0;
  let rleConflicts = 0;

  while (dst < decompSize && src < originalCompressed.length) {
    const control = originalCompressed[src++];

    if (control >= 128) {
      // --- LITERAL chunk: swap changed bytes, copy rest ---
      const count = control - 127;
      out.push(control);
      for (let i = 0; i < count && dst < decompSize && src < originalCompressed.length; i++) {
        if (changed.has(dst)) {
          out.push(newDecompressed[dst]);
          literalSwaps++;
        } else {
          out.push(originalCompressed[src]);
        }
        src++;
        dst++;
      }
    } else {
      // --- RLE chunk ---
      const count = control + 3;
      if (src >= originalCompressed.length) break;
      const origValue = originalCompressed[src++];
      const runStart = dst;
      const written = Math.min(count, decompSize - dst);

      // Check if any bytes in this run changed
      let hasChanges = false;
      for (let i = 0; i < written; i++) {
        if (changed.has(dst + i)) { hasChanges = true; break; }
      }

      if (!hasChanges) {
        // No changes → copy verbatim
        out.push(control);
        out.push(origValue);
      } else {
        // Check if all output bytes have the same value
        let allSame = true;
        const targetValue = newDecompressed[dst];
        for (let i = 1; i < written; i++) {
          if (newDecompressed[dst + i] !== targetValue) {
            allSame = false;
            break;
          }
        }

        if (allSame) {
          // Uniform value → swap RLE value byte (no size change)
          out.push(control);
          out.push(targetValue);
          rleValueSwaps++;
        } else if (allowSplits && runStart + written <= boundarySafeLimit) {
          // Mixed values, safe to re-encode as sub-chunks
          encodeRunToStream(newDecompressed, dst, written, out);
          rleSplits++;
        } else {
          // Can't handle: near boundary, or splits disabled → keep original
          out.push(control);
          out.push(origValue);
          rleConflicts++;
        }
      }

      dst += written;
    }
  }

  return { out, literalSwaps, rleValueSwaps, rleSplits, rleConflicts };
}

// ---------------------------------------------------------------------------
// Encode a slice of decompressed bytes into the output stream using optimal
// RLE/literal compression. Same algorithm as compressKeenRLE() but operates
// on a slice and appends to an existing output array (no 4-byte header).
// ---------------------------------------------------------------------------
function encodeRunToStream(data, offset, length, out) {
  let pos = 0;
  while (pos < length) {
    // Check for RLE run (3+ identical bytes)
    let runLen = 1;
    while (pos + runLen < length &&
           data[offset + pos + runLen] === data[offset + pos] &&
           runLen < 130) {
      runLen++;
    }

    if (runLen >= 3) {
      // RLE: control = runLen - 3 (0..127), then repeated byte
      out.push(runLen - 3);
      out.push(data[offset + pos]);
      pos += runLen;
    } else {
      // Literal: collect non-repeating bytes (up to 127)
      const litStart = pos;
      let litLen = 0;
      while (litLen < 127 && pos < length) {
        let ahead = 1;
        while (pos + ahead < length &&
               data[offset + pos + ahead] === data[offset + pos] &&
               ahead < 3) {
          ahead++;
        }
        if (ahead >= 3) break; // switch to RLE on next iteration
        pos++;
        litLen++;
      }
      if (litLen > 0) {
        out.push(litLen + 127); // control byte 128..254
        for (let i = 0; i < litLen; i++) {
          out.push(data[offset + litStart + i]);
        }
      }
    }
  }
}
