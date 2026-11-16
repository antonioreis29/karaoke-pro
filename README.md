# Karaoke Pro (MVP)

Software de karaokê para DJs, bares e eventos: biblioteca local, repertório online pelo YouTube, fila de cantores e tela do público sincronizada. Funciona offline para arquivos locais.

## Como executar

Requisitos: Windows 10/11 e Node.js 22.13 ou superior (testado com Node 24).

```bash
npm install
```

Aplicativo desktop (Electron):

```bash
npm start
```

Modo web (abre no Chrome/Edge pelo endereço exibido no terminal):

```bash
npm run web
```

Gerar instalador para Windows (não testado nesta etapa; baixa o electron-builder na primeira vez):

```bash
npm run dist
```

Os dados (catálogo, fila, histórico e configurações) ficam em um banco SQLite: em `%APPDATA%\karaoke-pro\data` no desktop e em `./data` no modo web.

## Uso rápido

1. **Importar**: botão *Pasta* (inclui subpastas) ou *Arquivos* no rodapé da biblioteca. `Queen - Bohemian Rhapsody.mp4` vira artista *Queen*, música *Bohemian Rhapsody*; o lápis de cada linha corrige os dados.
2. **Fila**: clique em **+** na música, digite o nome do cantor e Enter. O mesmo cantor pode ter vários pedidos.
3. **Tela do público**: botão no topo (tecla `P`). Com um segundo monitor, o aplicativo desktop abre em tela cheia nele; duplo clique alterna a tela cheia.
4. **Iniciar**: *Iniciar próximo* (ou ▶ em um pedido, com confirmação). Ao terminar, a apresentação vai para o *Histórico*.
5. **Online**: aba *Online* pesquisa karaokês no YouTube (exige chave gratuita da YouTube Data API v3, informada em Configurações) ou adiciona um vídeo colando o link, sem chave.

Atalhos: `Espaço` play/pause · `S` parar · `N` próximo cantor · `←/→` 5 s · `↑/↓` volume · `P` tela do público · `Ctrl+F` busca.

## Formatos

| Formato | Situação |
| --- | --- |
| MP4 (H.264/AAC), WebM | Reproduz vídeo e áudio |
| MP3, M4A, OGG, WAV | Reproduz áudio (sem letra) |
| MP3 + CDG (mesmo nome, mesma pasta) | Reproduz com letras CD+G |
| ZIP contendo MP3 + CDG | Reproduz com letras CD+G |
| MKV, MOV | Importa; só toca se os codecs forem suportados pelo Chromium |
| AVI | Importa, mas não toca (exige conversão com FFmpeg, ainda não implementada) |

## YouTube

- Pesquisa pela YouTube Data API v3 e reprodução pelo player oficial incorporado (IFrame Player API). Nada é baixado; o catálogo guarda apenas a referência do vídeo.
- Anúncios e restrições do YouTube são mantidos. Vídeos podem sair do ar ou ter a incorporação bloqueada pelo dono.
- A cota gratuita padrão permite cerca de 99 pesquisas por dia; resultados repetidos vêm do cache em memória.
- Um vídeo do YouTube toca em um único player: na tela do público quando ela está aberta, senão na prévia do operador.
- O filtro *Só Creative Commons* usa a licença informada pelo próprio YouTube (CC BY).

## Estrutura

```
electron/   shell desktop: janelas, segundo monitor, diálogos nativos
server/     serviço local (127.0.0.1): API, SQLite, varredura da biblioteca, streaming de mídia
src/
  player/   motor de reprodução, decodificador CDG, integração YouTube
  components/  biblioteca, player, fila, diálogos
  audience/ tela do público
  store.ts  estado global e regras da fila (rotação justa)
```

A interface conversa com o serviço local por HTTP (com token por sessão) e com a tela do público por `BroadcastChannel`, por isso o mesmo código roda no Electron e no navegador.

## Pendências conhecidas

- Controle de tonalidade (mudança de tom sem alterar a velocidade).
- Conversão de AVI/MKV com FFmpeg.
- Integração com repositórios dedicados de karaokê sob licença aberta (hoje há apenas o filtro Creative Commons do YouTube).
- Instalador do Windows e escolha manual do monitor da tela do público.
- Imagem de fundo personalizada na tela de espera.

Importe apenas arquivos que você tem licença ou autorização para usar.
