// Download / Save System
import { writeGameData, exportLevelSet } from './exe-parser.js';

export function downloadModifiedExe(gameData) {
  const modifiedExe = writeGameData(gameData);
  downloadBlob(modifiedExe, 'DAVE.EXE', 'application/octet-stream');
}

export function downloadModifiedDav(davData) {
  downloadBlob(davData, 'EGADAVE.DAV', 'application/octet-stream');
}

export function downloadLevelSetJson(gameData) {
  const json = exportLevelSet(gameData);
  const bytes = new TextEncoder().encode(json);
  downloadBlob(bytes, 'dangerous_dave_levels.json', 'application/json');
}

function downloadBlob(data, filename, mimeType) {
  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 100);
}
