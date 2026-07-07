const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const GAME_DIR = path.join(__dirname, '..');

http.createServer((req, res) => {
  let filePath;
  // Serve game files from parent directory
  if (req.url.startsWith('/gamefiles/')) {
    filePath = path.join(GAME_DIR, req.url.replace('/gamefiles/', ''));
  } else {
    filePath = path.join(ROOT, req.url === '/' ? 'index.html' : req.url);
  }
  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
