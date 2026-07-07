// Menu Editor - Text and graphics editing
import { EXE_OFFSETS, EGA_PALETTE } from './constants.js';

let gameData = null;
let menuGfxZoom = 4;
let offsetDelta = 0; // MZ header offset adjustment

// Parsed menu icon header data
let menuEntries = [];
let planeOffsets = []; // 4 plane base offsets (relative to section start)
const ICON_WIDTH = 32;
const ICON_HEIGHT = 24;
const ICON_WIDTH_BYTES = 4; // 32 pixels / 8 bits per byte
const HEADER_SIZE = 0x100; // 256-byte header
const ENTRY_COUNT = 13; // menu icon entries in header
const ACTIVE_OFFSET = 0x4E0; // 13 * 96 = where active-state icons start
const ACTIVE_COUNT = 10;
const ACTIVE_LABELS = [
  'CGA (sel)', 'EGA (sel)', 'VGA (sel)', 'SPKR (sel)', 'kbd (sel)',
  'joy1 (sel)', 'joy2 (sel)', 'mouse (sel)', 'Active 8', 'Active 9'
];

function off(refOffset) {
  return refOffset + offsetDelta;
}

// Editable text strings found in the EXE, organized by category.
// All offsets are wiki reference offsets (for 512-byte MZ header).
// The off() function adjusts to the actual header size at runtime.
const TEXT_GROUPS = [
  {
    heading: 'Level Messages',
    collapsed: false,
    strings: [
      { label: 'Levels 1-8 Complete', offset: 0x25EEA, maxLen: 34, desc: '"good work! only 9 more to go!"' },
      { label: 'Level 9 Complete', offset: 0x25F0D, maxLen: 34, desc: '"this is the last level!!!"' },
      { label: 'Game Finished', offset: 0x25F30, maxLen: 34, desc: '"yes! you finished the game!"' },
    ],
  },
  {
    heading: 'Score & Game Over',
    collapsed: false,
    strings: [
      { label: 'High Score Prompt', offset: 0x25F80, maxLen: 21, desc: '"You got a high score!"' },
      { label: 'Game Over', offset: 0x25F96, maxLen: 9, desc: '"Game Over"' },
      { label: 'Restart Prompt', offset: 0x25FDB, maxLen: 23, desc: '"Restart Game? (Y or N):"' },
    ],
  },
  {
    heading: 'Game Prompts',
    collapsed: false,
    strings: [
      { label: 'Quit Prompt', offset: 0x26407, maxLen: 15, desc: '"Quit? (Y or N):"' },
      { label: 'Pause Message', offset: 0x26417, maxLen: 22, desc: '"Press F9 to end pause:"' },
    ],
  },
  {
    heading: 'Title Screen',
    collapsed: false,
    strings: [
      { label: 'Credit Line', offset: 0x2643F, maxLen: 14, desc: '"BY JOHN ROMERO"' },
      { label: 'Copyright', offset: 0x26450, maxLen: 26, desc: '"(C) 1990 SOFTDISK, INC."' },
      { label: 'Help Prompt', offset: 0x2646B, maxLen: 25, desc: '"PRESS THE F1 KEY FOR HELP"' },
    ],
  },
  {
    heading: 'Congratulations Screen',
    collapsed: true,
    strings: [
      { label: 'Title', offset: 0x2648E, maxLen: 20, desc: '"congratulations!"' },
      { label: 'Line 1', offset: 0x264A3, maxLen: 34, desc: '"you made it through all the peril-"' },
      { label: 'Line 2', offset: 0x264C8, maxLen: 30, desc: '"ous areas in clyde\'s hideout!"' },
      { label: 'Line 3', offset: 0x264E9, maxLen: 28, desc: '"very good work! did you find"' },
      { label: 'Line 4', offset: 0x26508, maxLen: 34, desc: '"the 4 warp zones? they are located"' },
      { label: 'Line 5', offset: 0x2652D, maxLen: 33, desc: '"on levels 5,8,9 and 10. just jump"' },
      { label: 'Line 6', offset: 0x26551, maxLen: 32, desc: '"off the top of the screen at the"' },
      { label: 'Line 7', offset: 0x26574, maxLen: 33, desc: '"extreme left or right edge of the"' },
      { label: 'Line 8', offset: 0x26598, maxLen: 32, desc: '"world and voila! you\'re there!"' },
      { label: 'Dismiss', offset: 0x265BB, maxLen: 20, desc: '"press space"' },
    ],
  },
  {
    heading: 'Help Screen 1 — Controls',
    collapsed: true,
    strings: [
      { label: 'Title', offset: 0x25FF3, maxLen: 23, desc: '"dangerous dave"' },
      { label: 'Line 1', offset: 0x2600D, maxLen: 21, desc: '"you use the keyboard,"' },
      { label: 'Line 2', offset: 0x26025, maxLen: 22, desc: '"joystick or a mouse to"' },
      { label: 'Line 3', offset: 0x2603E, maxLen: 17, desc: '"to control dave."' },
      { label: 'Line 4', offset: 0x26052, maxLen: 22, desc: '"these are the function"' },
      { label: 'Line 5', offset: 0x2606B, maxLen: 23, desc: '"keys that are available"' },
      { label: 'Line 6', offset: 0x26085, maxLen: 13, desc: '"at any time:"' },
      { label: 'Key F1', offset: 0x26095, maxLen: 9, desc: '"f1 = help"' },
      { label: 'Key F2', offset: 0x260A1, maxLen: 18, desc: '"f2 = control panel"' },
      { label: 'Key F3', offset: 0x260B6, maxLen: 17, desc: '"f3 = restart game"' },
      { label: 'Key F9', offset: 0x260CA, maxLen: 15, desc: '"f9 = pause game"' },
      { label: 'Key F10', offset: 0x260DC, maxLen: 23, desc: '"f10 or esc = quit game"' },
      { label: 'Dismiss', offset: 0x260F6, maxLen: 19, desc: '"press space or esc"' },
    ],
  },
  {
    heading: 'Help Screen 2 — Objective',
    collapsed: true,
    strings: [
      { label: 'Title', offset: 0x2610C, maxLen: 22, desc: '"dangerous dave"' },
      { label: 'Line 1', offset: 0x26125, maxLen: 25, desc: '"the object of the game is"' },
      { label: 'Line 2', offset: 0x26141, maxLen: 24, desc: '"to guide dave through 10"' },
      { label: 'Line 3', offset: 0x2615C, maxLen: 25, desc: '"perilous areas in clyde\'s"' },
      { label: 'Line 4', offset: 0x26178, maxLen: 25, desc: '"hideout. there are guns &"' },
      { label: 'Line 5', offset: 0x26194, maxLen: 21, desc: '"jetpacks to aid you."' },
      { label: 'Line 6', offset: 0x261AC, maxLen: 26, desc: '"in the control panel (f2),"' },
      { label: 'Line 7', offset: 0x261C9, maxLen: 26, desc: '"you will find the keyboard"' },
      { label: 'Line 8', offset: 0x261E6, maxLen: 26, desc: '"keys used for moving (they"' },
      { label: 'Line 9', offset: 0x26203, maxLen: 24, desc: '"can be redefined). using"' },
      { label: 'Line 10', offset: 0x2621E, maxLen: 26, desc: '"the joystick or mouse, the"' },
      { label: 'Line 11', offset: 0x2623B, maxLen: 26, desc: '"left button will shoot and"' },
      { label: 'Line 12', offset: 0x26258, maxLen: 26, desc: '"the right will turn on/off"' },
      { label: 'Line 13', offset: 0x26275, maxLen: 15, desc: '"the jetpack."' },
      { label: 'Dismiss', offset: 0x26287, maxLen: 19, desc: '"press space or esc"' },
    ],
  },
  {
    heading: 'Help Screen 3 — Hazards',
    collapsed: true,
    strings: [
      { label: 'Title', offset: 0x2629D, maxLen: 22, desc: '"dangerous dave"' },
      { label: 'Line 1', offset: 0x262B6, maxLen: 25, desc: '"watch out for fire, water"' },
      { label: 'Line 2', offset: 0x262D2, maxLen: 26, desc: '"and weirdweeds! these will"' },
      { label: 'Line 3', offset: 0x262EF, maxLen: 25, desc: '"toast dave very blackly!"' },
      { label: 'Line 4', offset: 0x2630B, maxLen: 26, desc: '"merely grab the trophy and"' },
      { label: 'Line 5', offset: 0x26328, maxLen: 27, desc: '"walk through the door. it\'s"' },
      { label: 'Line 6', offset: 0x26346, maxLen: 27, desc: '"that simple! of course, you"' },
      { label: 'Line 7', offset: 0x26364, maxLen: 24, desc: '"might run into a few (?)"' },
      { label: 'Line 8', offset: 0x2637F, maxLen: 12, desc: '"monsters..."' },
      { label: 'Line 9', offset: 0x2638E, maxLen: 24, desc: '"also ... there are a few"' },
      { label: 'Line 10', offset: 0x263A9, maxLen: 26, desc: '"places dave can go by try-"' },
      { label: 'Line 11', offset: 0x263C6, maxLen: 25, desc: '"ing something strange and"' },
      { label: 'Line 12', offset: 0x263E2, maxLen: 14, desc: '"dangerous..."' },
      { label: 'Dismiss', offset: 0x263F3, maxLen: 17, desc: '"press space"' },
    ],
  },
  {
    heading: 'Control Panel',
    collapsed: true,
    strings: [
      { label: 'Panel Title', offset: 0x26913, maxLen: 23, desc: '"PC-Arcade Control Panel"' },
      { label: 'VIDEO label', offset: 0x2692D, maxLen: 6, desc: '"VIDEO:"' },
      { label: 'SOUND label', offset: 0x26934, maxLen: 6, desc: '"SOUND:"' },
      { label: 'CONTROL label', offset: 0x2693B, maxLen: 8, desc: '"CONTROL:"' },
      { label: 'Instruction 1', offset: 0x26944, maxLen: 38, desc: '"Move the cursor with the arrow keys"' },
      { label: 'Instruction 2', offset: 0x2696D, maxLen: 38, desc: '"Make decisions with the ENTER key"' },
      { label: 'Instruction 3', offset: 0x26996, maxLen: 38, desc: '"ESC to return to your game"' },
    ],
  },
  {
    heading: 'Keyboard Config',
    collapsed: true,
    strings: [
      { label: 'Title', offset: 0x26803, maxLen: 22, desc: '"Keyboard Configuration"' },
      { label: 'Direction 0', offset: 0x26835, maxLen: 12, desc: '"0 north    :"' },
      { label: 'Direction 1', offset: 0x26844, maxLen: 12, desc: '"1 northeast:"' },
      { label: 'Direction 2', offset: 0x26853, maxLen: 12, desc: '"2 east     :"' },
      { label: 'Direction 3', offset: 0x26862, maxLen: 12, desc: '"3 southeast:"' },
      { label: 'Direction 4', offset: 0x26871, maxLen: 12, desc: '"4 south    :"' },
      { label: 'Direction 5', offset: 0x26880, maxLen: 12, desc: '"5 southwest:"' },
      { label: 'Direction 6', offset: 0x2688F, maxLen: 12, desc: '"6 west     :"' },
      { label: 'Direction 7', offset: 0x268AD, maxLen: 12, desc: '"7 northwest:"' },
      { label: 'Button 1', offset: 0x268AD, maxLen: 12, desc: '"8 button1  :"' },
      { label: 'Button 2', offset: 0x268BC, maxLen: 12, desc: '"9 button2  :"' },
      { label: 'Modify Prompt', offset: 0x268CC, maxLen: 20, desc: '"Modify which action:"' },
      { label: 'New Key Prompt', offset: 0x268E3, maxLen: 18, desc: '"Press the new key:"' },
    ],
  },
  {
    heading: 'Joystick Config',
    collapsed: true,
    strings: [
      { label: 'Instruction 1', offset: 0x26696, maxLen: 24, desc: '"Hold the joystick in the"' },
      { label: 'Upper Left', offset: 0x266B1, maxLen: 10, desc: '"upper left"' },
      { label: 'Fire 1', offset: 0x266BE, maxLen: 20, desc: '"corner and hit fire:"' },
      { label: 'Instruction 2', offset: 0x266D6, maxLen: 24, desc: '"Hold the joystick in the"' },
      { label: 'Lower Right', offset: 0x266F1, maxLen: 11, desc: '"lower right"' },
      { label: 'Fire 2', offset: 0x266FF, maxLen: 20, desc: '"corner and hit fire:"' },
    ],
  },
  {
    heading: 'Mouse Config',
    collapsed: true,
    strings: [
      { label: 'Title', offset: 0x26714, maxLen: 24, desc: '"Mouse Configuration"' },
      { label: 'Line 1', offset: 0x2674A, maxLen: 24, desc: '"Choose the sensitivity"' },
      { label: 'Line 2', offset: 0x26765, maxLen: 24, desc: '"of the mouse, 1 being"' },
      { label: 'Line 3', offset: 0x26780, maxLen: 19, desc: '"slow, 9 being fast:"' },
    ],
  },
  {
    heading: 'Error Messages',
    collapsed: true,
    strings: [
      { label: 'Memory Error', offset: 0x269EE, maxLen: 14, desc: '"Out of memory!"' },
      { label: 'Tileset Error', offset: 0x26A80, maxLen: 24, desc: '"Trouble loading tileset!"' },
    ],
  },
];

export function initMenuEditor(appState) {
  gameData = appState.gameData;
  offsetDelta = gameData._offsetDelta || 0;
  parseMenuHeader();
  buildTextEditor();
  buildColorPicker();
  buildGfxControls();
  renderAllIcons();
}

function parseMenuHeader() {
  const sectionStart = off(EXE_OFFSETS.MENU_FONT_EGA);
  const raw = gameData.rawExe;
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);

  // 4 plane base offsets at +0x18 (stored as segment:offset pairs, segment * 16 = linear)
  planeOffsets = [];
  for (let i = 0; i < 4; i++) {
    const seg = view.getUint16(sectionStart + 0x18 + i * 4 + 2, true);
    planeOffsets.push(seg * 16);
  }

  // 13 menu entries at +0x28, each 16 bytes
  menuEntries = [];
  for (let i = 0; i < ENTRY_COUNT; i++) {
    const base = sectionStart + 0x28 + i * 16;
    const widthBytes = view.getUint16(base, true);
    const height = view.getUint16(base + 2, true);
    const dataOffset = view.getUint32(base + 4, true);
    let label = '';
    for (let j = 0; j < 8; j++) {
      const ch = raw[base + 8 + j];
      if (ch === 0) break;
      label += String.fromCharCode(ch);
    }
    menuEntries.push({ widthBytes, height, dataOffset, label });
  }
}

function buildTextEditor() {
  const section = document.getElementById('menu-text-section');
  section.innerHTML = `
    <h3>Game Text Strings</h3>
    <p class="hint">Edit all text strings stored in the EXE. Changes are written live — download the modified EXE to save. Stay within max length (game will crash if exceeded).</p>
    <div id="text-groups-container"></div>
    <h3 style="margin-top:12px">Custom String Search</h3>
    <p class="hint">Find and edit any ASCII string in the EXE by offset.</p>
    <div style="display:flex;gap:8px;align-items:center;margin-top:4px">
      <label style="font-size:11px">Offset (hex):
        <input type="text" id="custom-offset" style="width:80px;background:#0d1b2a;border:1px solid #0f3460;color:#55ff55;font-family:monospace;padding:2px 4px" placeholder="0x262D4">
      </label>
      <label style="font-size:11px">Length:
        <input type="number" id="custom-len" value="30" min="1" max="80" style="width:50px;background:#0d1b2a;border:1px solid #0f3460;color:#e0e0e0;padding:2px 4px">
      </label>
      <button id="btn-read-string" style="font-size:11px">Read</button>
    </div>
    <div id="custom-string-area" style="margin-top:4px"></div>
  `;

  const container = document.getElementById('text-groups-container');
  for (const group of TEXT_GROUPS) {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'text-group';

    // Collapsible group heading
    const heading = document.createElement('div');
    heading.className = 'text-group-heading';
    heading.innerHTML = `<span class="text-group-arrow">${group.collapsed ? '\u25B6' : '\u25BC'}</span> ${group.heading} <span class="text-group-count">(${group.strings.length})</span>`;
    groupDiv.appendChild(heading);

    // String fields container
    const fields = document.createElement('div');
    fields.className = 'text-group-fields';
    fields.style.display = group.collapsed ? 'none' : 'block';

    for (const def of group.strings) {
      const adjOffset = off(def.offset);
      const value = readNullTerminated(gameData.rawExe, adjOffset, def.maxLen);
      const field = document.createElement('div');
      field.className = 'menu-field';
      field.innerHTML = `
        <label>${def.label} <span style="color:#666;font-size:10px">(max ${def.maxLen})</span>
          <span style="color:#444;font-size:9px;margin-left:4px" title="Wiki reference offset">0x${def.offset.toString(16)}</span>
        </label>
        <input type="text" maxlength="${def.maxLen}" value=""
               style="width:340px;background:#0d1b2a;border:1px solid #0f3460;color:#55ff55;padding:4px 8px;font-size:13px;font-family:'Courier New',monospace;letter-spacing:1px"
               data-offset="${adjOffset}" data-maxlen="${def.maxLen}">
      `;
      const input = field.querySelector('input');
      input.value = value;
      input.addEventListener('input', () => {
        writeNullTerminated(gameData.rawExe, adjOffset, input.value, def.maxLen);
      });
      fields.appendChild(field);
    }

    groupDiv.appendChild(fields);

    // Toggle collapse on heading click
    heading.addEventListener('click', () => {
      const isCollapsed = fields.style.display === 'none';
      fields.style.display = isCollapsed ? 'block' : 'none';
      heading.querySelector('.text-group-arrow').textContent = isCollapsed ? '\u25BC' : '\u25B6';
    });

    container.appendChild(groupDiv);
  }

  // Custom string reader
  document.getElementById('btn-read-string').addEventListener('click', () => {
    const offsetStr = document.getElementById('custom-offset').value.trim();
    const len = parseInt(document.getElementById('custom-len').value) || 30;
    let offset;
    if (offsetStr.startsWith('0x')) {
      offset = parseInt(offsetStr, 16);
    } else {
      offset = parseInt(offsetStr);
    }
    if (isNaN(offset) || offset < 0 || offset >= gameData.rawExe.length) {
      document.getElementById('custom-string-area').textContent = 'Invalid offset';
      return;
    }
    const value = readNullTerminated(gameData.rawExe, offset, len);
    const area = document.getElementById('custom-string-area');
    area.innerHTML = '';
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = len;
    input.value = value;
    input.style.cssText = 'width:340px;background:#0d1b2a;border:1px solid #0f3460;color:#55ff55;padding:4px 8px;font-size:13px;font-family:monospace';
    input.addEventListener('input', () => {
      writeNullTerminated(gameData.rawExe, offset, input.value, len);
    });
    area.appendChild(input);
  });
}

function readNullTerminated(data, offset, maxLen) {
  let str = '';
  for (let i = 0; i < maxLen; i++) {
    if (offset + i >= data.length) break;
    const byte = data[offset + i];
    if (byte === 0) break;
    if (byte >= 32 && byte < 127) {
      str += String.fromCharCode(byte);
    } else if (byte === 0x0D || byte === 0x0A) {
      // Skip CR/LF
    } else {
      str += '.';
    }
  }
  return str;
}

function writeNullTerminated(data, offset, str, maxLen) {
  for (let i = 0; i < maxLen; i++) {
    if (i < str.length) {
      data[offset + i] = str.charCodeAt(i);
    } else {
      data[offset + i] = 0; // null terminate
    }
  }
}

let selectedColor = 15; // white

function buildColorPicker() {
  const container = document.getElementById('ega-color-picker');
  container.innerHTML = '';

  for (let i = 0; i < 16; i++) {
    const swatch = document.createElement('div');
    swatch.className = 'ega-color-swatch';
    if (i === selectedColor) swatch.classList.add('selected');
    swatch.style.backgroundColor = `rgb(${EGA_PALETTE[i].join(',')})`;
    swatch.addEventListener('click', () => {
      container.querySelectorAll('.ega-color-swatch').forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
      selectedColor = i;
    });
    container.appendChild(swatch);
  }
}

function buildGfxControls() {
  // Zoom handler
  document.getElementById('menu-zoom').addEventListener('input', (e) => {
    menuGfxZoom = parseInt(e.target.value);
    renderAllIcons();
  });
}

function renderIconToCanvas(canvas, dataOffset, widthBytes, height) {
  const ctx = canvas.getContext('2d');
  const sectionStart = off(EXE_OFFSETS.MENU_FONT_EGA);
  const w = widthBytes * 8;
  const h = height;

  canvas.width = w * menuGfxZoom;
  canvas.height = h * menuGfxZoom;

  const imgData = ctx.createImageData(w, h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const byteIdx = Math.floor(x / 8);
      const bitIdx = 7 - (x % 8);

      let colorIdx = 0;
      for (let plane = 0; plane < 4; plane++) {
        const absOffset = sectionStart + planeOffsets[plane] + dataOffset + y * widthBytes + byteIdx;
        if (absOffset >= gameData.rawExe.length) continue;
        const bit = (gameData.rawExe[absOffset] >> bitIdx) & 1;
        colorIdx |= (bit << plane);
      }

      const color = EGA_PALETTE[colorIdx];
      const pixOff = (y * w + x) * 4;
      imgData.data[pixOff] = color[0];
      imgData.data[pixOff + 1] = color[1];
      imgData.data[pixOff + 2] = color[2];
      imgData.data[pixOff + 3] = 255;
    }
  }

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = w;
  tempCanvas.height = h;
  tempCanvas.getContext('2d').putImageData(imgData, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);
}

function renderAllIcons() {
  const container = document.getElementById('menu-gfx-container');
  container.innerHTML = '';

  // Section: Inactive/normal state icons (from header entries)
  const inactiveLabel = document.createElement('div');
  inactiveLabel.style.cssText = 'font-size:11px;color:#888;margin-bottom:4px;width:100%';
  inactiveLabel.textContent = 'Config Screen Icons (normal state):';
  container.appendChild(inactiveLabel);

  const inactiveGrid = document.createElement('div');
  inactiveGrid.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px';
  container.appendChild(inactiveGrid);

  for (let i = 0; i < menuEntries.length; i++) {
    const entry = menuEntries[i];
    const card = createIconCard(entry.label, entry.dataOffset, entry.widthBytes, entry.height);
    inactiveGrid.appendChild(card);
  }

  // Section: Active/selected state icons
  const activeLabel = document.createElement('div');
  activeLabel.style.cssText = 'font-size:11px;color:#888;margin-bottom:4px;width:100%';
  activeLabel.textContent = 'Config Screen Icons (selected state):';
  container.appendChild(activeLabel);

  const activeGrid = document.createElement('div');
  activeGrid.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px';
  container.appendChild(activeGrid);

  for (let i = 0; i < ACTIVE_COUNT; i++) {
    const dataOffset = ACTIVE_OFFSET + i * (ICON_WIDTH_BYTES * ICON_HEIGHT);
    const label = ACTIVE_LABELS[i];
    const card = createIconCard(label, dataOffset, ICON_WIDTH_BYTES, ICON_HEIGHT);
    activeGrid.appendChild(card);
  }
}

function createIconCard(label, dataOffset, widthBytes, height) {
  const card = document.createElement('div');
  card.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px';

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'image-rendering:pixelated;cursor:crosshair;border:1px solid #0f3460';
  canvas.dataset.dataOffset = dataOffset;
  canvas.dataset.widthBytes = widthBytes;
  canvas.dataset.height = height;
  renderIconToCanvas(canvas, dataOffset, widthBytes, height);

  canvas.addEventListener('click', (e) => onIconClick(e, canvas, dataOffset, widthBytes, height));

  const lbl = document.createElement('span');
  lbl.style.cssText = 'font-size:10px;color:#aaa;font-family:monospace';
  lbl.textContent = label;

  card.appendChild(canvas);
  card.appendChild(lbl);
  return card;
}

function onIconClick(e, canvas, dataOffset, widthBytes, height) {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) / menuGfxZoom);
  const y = Math.floor((e.clientY - rect.top) / menuGfxZoom);
  const w = widthBytes * 8;

  if (x < 0 || x >= w || y < 0 || y >= height) return;

  const sectionStart = off(EXE_OFFSETS.MENU_FONT_EGA);
  const byteIdx = Math.floor(x / 8);
  const bitIdx = 7 - (x % 8);
  const mask = ~(1 << bitIdx) & 0xFF;

  // Write to all 4 planes
  for (let plane = 0; plane < 4; plane++) {
    const absOffset = sectionStart + planeOffsets[plane] + dataOffset + y * widthBytes + byteIdx;
    if (absOffset >= gameData.rawExe.length) return;
    const bit = (selectedColor >> plane) & 1;
    gameData.rawExe[absOffset] = (gameData.rawExe[absOffset] & mask) | (bit << bitIdx);
  }

  renderIconToCanvas(canvas, dataOffset, widthBytes, height);
}
