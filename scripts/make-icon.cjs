// Gera build/icon.ico (16 a 256 px, instalador e atalhos), build/icon.png e electron/icon.png (janelas) a partir de build/icon.svg.
// Uso: npx electron scripts/make-icon.cjs   (usa o Chromium do Electron para desenhar o SVG)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'build', 'icon.svg'), 'utf8');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

/** ICO com imagens PNG (formato aceito pelo Windows desde o Vista). */
function toIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([header, dir, ...pngs.map((p) => p.data)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('about:blank');
  const render = (size) =>
    win.webContents.executeJavaScript(`(async () => {
      const img = new Image();
      img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(svg).toString('base64'))};
      await img.decode();
      const c = document.createElement('canvas');
      c.width = c.height = ${size};
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, ${size}, ${size});
      return c.toDataURL('image/png').split(',')[1];
    })()`);
  const pngs = [];
  for (const size of SIZES) pngs.push({ size, data: Buffer.from(await render(size), 'base64') });
  fs.writeFileSync(path.join(root, 'build', 'icon.ico'), toIco(pngs));
  const big = Buffer.from(await render(512), 'base64');
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), big);
  fs.writeFileSync(path.join(root, 'electron', 'icon.png'), big); // ícone das janelas do app
  console.log('ícones gerados:', SIZES.join(', '), '+ 512 px');
  app.quit();
});
