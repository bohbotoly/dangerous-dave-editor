// EGADAVE.DAV Parser - Decodes EGA tile graphics
import { EGA_PALETTE } from './constants.js';

export function parseTileset(davData) {
  const view = new DataView(davData.buffer, davData.byteOffset, davData.byteLength);
  const tileCount = view.getUint32(0, true);

  // Read offset table
  const offsets = [];
  for (let i = 0; i < tileCount; i++) {
    offsets.push(view.getUint32(4 + i * 4, true));
  }

  const tiles = [];
  for (let i = 0; i < tileCount; i++) {
    const offset = offsets[i];
    const nextOffset = (i + 1 < tileCount) ? offsets[i + 1] : davData.length;
    const size = nextOffset - offset;

    let width, height, hasHeader, dataStart;

    if (size === 128) {
      // Standard 16x16 tile, no header
      width = 16;
      height = 16;
      hasHeader = false;
      dataStart = offset;
    } else {
      // Variable-size sprite with 4-byte header
      width = view.getUint16(offset, true);
      height = view.getUint16(offset + 2, true);
      hasHeader = true;
      dataStart = offset + 4;

      // Sanity check
      if (width === 0 || height === 0 || width > 256 || height > 256) {
        width = 16;
        height = 16;
        hasHeader = false;
        dataStart = offset;
      }
    }

    const imageData = decodeEGATile(davData, dataStart, width, height);
    tiles.push({
      index: i,
      width,
      height,
      imageData,
      offset,
      size,
      hasHeader,
    });
  }

  return tiles;
}

function decodeEGATile(data, offset, width, height) {
  const bytesPerPlaneRow = Math.ceil(width / 8);
  const bytesPerRow = bytesPerPlaneRow * 4; // 4 planes: I, R, G, B
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(width, height)
    : document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(width, height);
  const pixels = imgData.data;

  for (let y = 0; y < height; y++) {
    const rowStart = offset + y * bytesPerRow;

    for (let x = 0; x < width; x++) {
      const byteIndex = Math.floor(x / 8);
      const bitIndex = 7 - (x % 8);

      // Read 4 planes: I, R, G, B
      const iPlane = rowStart + byteIndex;
      const rPlane = rowStart + bytesPerPlaneRow + byteIndex;
      const gPlane = rowStart + bytesPerPlaneRow * 2 + byteIndex;
      const bPlane = rowStart + bytesPerPlaneRow * 3 + byteIndex;

      // Bounds check
      if (bPlane >= data.length) continue;

      const iBit = (data[iPlane] >>> bitIndex) & 1;
      const rBit = (data[rPlane] >>> bitIndex) & 1;
      const gBit = (data[gPlane] >>> bitIndex) & 1;
      const bBit = (data[bPlane] >>> bitIndex) & 1;

      const colorIndex = (iBit << 3) | (rBit << 2) | (gBit << 1) | bBit;
      const color = EGA_PALETTE[colorIndex];

      const pixelOffset = (y * width + x) * 4;
      pixels[pixelOffset] = color[0];     // R
      pixels[pixelOffset + 1] = color[1]; // G
      pixels[pixelOffset + 2] = color[2]; // B
      pixels[pixelOffset + 3] = (colorIndex === 0) ? 0 : 255; // transparent for black on sprites
    }
  }

  return imgData;
}

// Re-encode a tile's ImageData back to EGA row-planar format
export function encodeEGATile(imageData, width, height) {
  const bytesPerPlaneRow = Math.ceil(width / 8);
  const bytesPerRow = bytesPerPlaneRow * 4;
  const result = new Uint8Array(bytesPerRow * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelOffset = (y * width + x) * 4;
      const r = imageData.data[pixelOffset];
      const g = imageData.data[pixelOffset + 1];
      const b = imageData.data[pixelOffset + 2];

      // Find closest EGA color
      const colorIndex = findClosestEGAColor(r, g, b);

      const byteIndex = Math.floor(x / 8);
      const bitIndex = 7 - (x % 8);
      const rowStart = y * bytesPerRow;

      if (colorIndex & 8) result[rowStart + byteIndex] |= (1 << bitIndex);                          // I
      if (colorIndex & 4) result[rowStart + bytesPerPlaneRow + byteIndex] |= (1 << bitIndex);       // R
      if (colorIndex & 2) result[rowStart + bytesPerPlaneRow * 2 + byteIndex] |= (1 << bitIndex);   // G
      if (colorIndex & 1) result[rowStart + bytesPerPlaneRow * 3 + byteIndex] |= (1 << bitIndex);   // B
    }
  }

  return result;
}

function findClosestEGAColor(r, g, b) {
  let bestIndex = 0;
  let bestDist = Infinity;
  for (let i = 0; i < 16; i++) {
    const c = EGA_PALETTE[i];
    const dr = r - c[0], dg = g - c[1], db = b - c[2];
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      bestIndex = i;
    }
  }
  return bestIndex;
}

// Render a tile to an offscreen canvas for fast drawImage() compositing
export function tileToCanvas(tile) {
  const canvas = document.createElement('canvas');
  canvas.width = tile.width;
  canvas.height = tile.height;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(tile.imageData, 0, 0);
  return canvas;
}

// Render tile opaque (no transparency for tile 0 background)
export function tileToCanvasOpaque(tile) {
  const canvas = document.createElement('canvas');
  canvas.width = tile.width;
  canvas.height = tile.height;
  const ctx = canvas.getContext('2d');
  // Make a copy with full alpha
  const copy = new ImageData(tile.width, tile.height);
  for (let i = 0; i < tile.imageData.data.length; i += 4) {
    copy.data[i] = tile.imageData.data[i];
    copy.data[i + 1] = tile.imageData.data[i + 1];
    copy.data[i + 2] = tile.imageData.data[i + 2];
    copy.data[i + 3] = 255;
  }
  ctx.putImageData(copy, 0, 0);
  return canvas;
}
