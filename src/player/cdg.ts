// Decodificador de CD+G (gráficos de karaokê): 300 pacotes de 24 bytes por segundo, tela de 300x216 com 16 cores.
const W = 300;
const H = 216;
const PACKET = 24;
const PPS = 300;

export class CdgPlayer {
  private pixels = new Uint8Array(W * H);
  private clut = new Uint32Array(16);
  private pos = 0; // próximo pacote a processar
  private hOff = 0;
  private vOff = 0;
  private dirty = true;
  private image: ImageData;
  private ctx: CanvasRenderingContext2D;
  private readonly packets: number;

  constructor(private data: Uint8Array, canvas: HTMLCanvasElement) {
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext('2d')!;
    this.image = this.ctx.createImageData(W, H);
    this.packets = Math.floor(data.length / PACKET);
    this.reset();
  }

  get duration() {
    return this.packets / PPS;
  }

  private reset() {
    this.pixels.fill(0);
    this.clut.fill(0xff000000);
    this.pos = 0;
    this.hOff = this.vOff = 0;
    this.dirty = true;
  }

  /** Avança (ou reconstrói, ao retroceder) até o instante informado e desenha o quadro. */
  render(time: number) {
    const target = Math.min(this.packets, Math.max(0, Math.floor(time * PPS)));
    if (target < this.pos) this.reset();
    while (this.pos < target) this.packet(this.pos++ * PACKET);
    if (this.dirty) this.draw();
  }

  private packet(o: number) {
    const d = this.data;
    if ((d[o] & 0x3f) !== 9) return;
    const inst = d[o + 1] & 0x3f;
    const p = o + 4;
    switch (inst) {
      case 1: // limpar tela
        this.pixels.fill(d[p] & 0x0f);
        this.dirty = true;
        break;
      case 2: { // borda
        const c = d[p] & 0x0f;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            if (x < 6 || x >= W - 6 || y < 12 || y >= H - 12) this.pixels[y * W + x] = c;
          }
        }
        this.dirty = true;
        break;
      }
      case 6:
      case 38: { // bloco 6x12 (normal ou XOR)
        const c0 = d[p] & 0x0f;
        const c1 = d[p + 1] & 0x0f;
        const row = d[p + 2] & 0x1f;
        const col = d[p + 3] & 0x3f;
        if (row >= 18 || col >= 50) break;
        for (let y = 0; y < 12; y++) {
          const bits = d[p + 4 + y] & 0x3f;
          const base = (row * 12 + y) * W + col * 6;
          for (let x = 0; x < 6; x++) {
            const on = (bits >> (5 - x)) & 1;
            if (inst === 38) this.pixels[base + x] ^= on ? c1 : c0;
            else this.pixels[base + x] = on ? c1 : c0;
          }
        }
        this.dirty = true;
        break;
      }
      case 20:
      case 24: // rolagem (com preenchimento ou circular)
        this.scroll(d[p] & 0x0f, d[p + 1] & 0x3f, d[p + 2] & 0x3f, inst === 24);
        break;
      case 30:
      case 31: { // paleta (8 cores por pacote)
        const start = inst === 30 ? 0 : 8;
        for (let i = 0; i < 8; i++) {
          const hi = d[p + i * 2] & 0x3f;
          const lo = d[p + i * 2 + 1] & 0x3f;
          const r = ((hi & 0x3c) >> 2) * 17;
          const g = (((hi & 0x03) << 2) | ((lo & 0x30) >> 4)) * 17;
          const b = (lo & 0x0f) * 17;
          this.clut[start + i] = 0xff000000 | (b << 16) | (g << 8) | r; // ABGR (little-endian)
        }
        this.dirty = true;
        break;
      }
    }
  }

  private scroll(color: number, hs: number, vs: number, copy: boolean) {
    const hCmd = (hs & 0x30) >> 4;
    const vCmd = (vs & 0x30) >> 4;
    this.hOff = Math.min(hs & 0x07, 5);
    this.vOff = Math.min(vs & 0x0f, 11);
    const dx = hCmd === 1 ? 6 : hCmd === 2 ? -6 : 0;
    const dy = vCmd === 1 ? 12 : vCmd === 2 ? -12 : 0;
    this.dirty = true;
    if (!dx && !dy) return;
    const src = this.pixels.slice();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const sx = x - dx;
        const sy = y - dy;
        const inside = sx >= 0 && sx < W && sy >= 0 && sy < H;
        this.pixels[y * W + x] = inside ? src[sy * W + sx] : copy ? src[((sy + H) % H) * W + ((sx + W) % W)] : color;
      }
    }
  }

  private draw() {
    const out = new Uint32Array(this.image.data.buffer);
    for (let y = 0; y < H; y++) {
      const sy = Math.min(H - 1, y + this.vOff);
      for (let x = 0; x < W; x++) {
        out[y * W + x] = this.clut[this.pixels[sy * W + Math.min(W - 1, x + this.hOff)]];
      }
    }
    this.ctx.putImageData(this.image, 0, 0);
    this.dirty = false;
  }
}

export async function loadCdg(url: string, canvas: HTMLCanvasElement): Promise<CdgPlayer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Não foi possível carregar o arquivo CDG');
  return new CdgPlayer(new Uint8Array(await res.arrayBuffer()), canvas);
}
