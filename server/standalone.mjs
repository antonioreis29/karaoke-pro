// Modo web: executa o mesmo servidor fora do Electron (abra o endereço exibido no Chrome ou Edge).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => process.argv.find((a) => a.startsWith('--' + name + '='))?.split('=').slice(1).join('=');
const dataDir = arg('data') || process.env.KP_DATA_DIR || path.join(root, 'data');
const port = Number(arg('port') || process.env.KP_PORT) || undefined;

const srv = await startServer({ dataDir, port, desktop: false });
console.log(`Karaoke Pro (modo web) em ${srv.url}`);
console.log(`Dados em ${dataDir}`);
