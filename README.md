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

6. **Vinheta**: antes de cada cantor, a tela do público mostra o nome do cantor e a música com uma trilha de fundo gerada pelo próprio app (12 s por padrão). Enquanto ela toca, a música é carregada; quando a vinheta acaba, a música entra sem espera. Vídeos do YouTube não podem ser preparados escondidos (as regras do YouTube proíbem elementos na frente do player): durante a vinheta só o código do player e a conexão são adiantados, e o vídeo leva cerca de 1 s para começar. Se a música demorar mais que a vinheta, a vinheta continua até ela estar pronta. Duração, volume e liga/desliga ficam em Configurações; `Espaço` pula a vinheta.
7. **Fila**: arraste um pedido para mudar a ordem. Arrastar com a *Rotação justa* ligada volta para a ordem manual.
8. **Microfones**: aba *Microfones* abaixo do player. *Detectar microfones* lista as entradas do computador; cada uma tem liga/desliga, volume, medidor e mudo, além de volume geral, eco, graves e agudos. A voz sai pela mesma saída de som da música.
9. **Tela cheia**: `F11` ou o botão no topo (aplicativo); `F`, `F11`, duplo clique ou o botão que aparece ao mover o mouse (tela do público); `Esc` sai.

10. **Pedidos pelo celular**: botão *Pedidos* no topo. Ao ligar, aparece um QR code (também mostrado na tela de espera do público). Os convidados, no mesmo Wi-Fi, buscam uma música da biblioteca, digitam o nome e pedem; o pedido chega para o operador aprovar (ou direto na fila, se a aprovação estiver desligada), e o celular mostra a posição na fila.
    - A página do celular só busca músicas e cria pedidos: não toca, não pausa e não vê a fila dos outros.
    - Exige o código do QR code; *Gerar novo código* invalida os QR codes antigos. Limites: um pedido a cada 15 s e até 3 pedidos na fila por celular.
    - Durante as músicas, o QR code também aparece na faixa de baixo da tela do público, ao lado do nome da música e fora do vídeo (as regras do YouTube não permitem nada por cima do player). Dá para desligar em Configurações › Tela do público.
    - Fica desligado por padrão. Na primeira vez, o Windows pode perguntar se o Karaoke Pro pode usar a rede: permita em *Redes privadas*.
    - Os convidados também podem buscar no YouTube (opção na janela *Pedidos*, precisa da chave da API). A busca é feita pelo app, a chave não vai para o celular, e só gasta cota quando a pessoa toca em *Buscar no YouTube*: buscas repetidas vêm do cache. Limites: 1 busca nova a cada 20 s e 15 por dia por celular, 60 por dia somando todos.

Atalhos: `Espaço` play/pause · `S` parar · `N` próximo cantor · `←/→` 5 s · `↑/↓` volume · `P` tela do público · `F11` tela cheia · `Ctrl+F` busca.

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
- **Vídeos bloqueados** (o dono não deixa tocar fora do YouTube, erro 101/150, ou vídeo removido):
  - *Verificação antecipada*: com o palco livre, o app testa na prévia do operador, sem som, cada vídeo do YouTube que está na fila (também pelo botão *Verificar vídeos do YouTube*). Os que tocam ganham o selo *verificado*.
  - *Troca automática*: vídeo bloqueado é marcado e o pedido passa para outra versão da mesma música que tocou no teste (precisa da chave da API). Sem versão que toque, o operador é avisado para trocar a música.
  - *Na hora*: se um vídeo falhar ao começar, outra versão é tentada uma vez e o cantor não perde a vez. A verificação antecipada pode testar até três alternativas.
  - Vídeos marcados como bloqueados somem das buscas do operador e dos celulares.
  - *Falha geral*: vários vídeos falhando não provam uma checagem anti-robô. O app interrompe tentativas automáticas e mostra um aviso inconclusivo. Ele não atribui a causa à conexão nem marca todos os vídeos como bloqueados.
  - **153**: falta de identificação do player/Referer; diferente de **101/150**, que indicam recusa da incorporação. A interface envia `Referrer-Policy: strict-origin-when-cross-origin`, informa sua origem ao player e usa `localhost` nas duas janelas. No Electron, se o Referer estiver ausente, a própria identidade do app é enviada. Isso não remove restrições do vídeo.
  - Bloqueio de autoplay é tratado separadamente: use o Play do player oficial, que também fica disponível na tela do público.
- **Conta do YouTube no app**: quando o player pede "faça login para confirmar que você não é um robô", use *Entrar no YouTube* (Configurações ou o aviso na fila). Abre a página oficial de login do Google numa janela do app; a sessão fica guardada no app e o player passa a tocar com a sua conta. O app não vê nem guarda a senha. *Sair da conta* apaga essa sessão do app (não afeta o navegador). O Google pode recusar o login em aplicativos desse tipo; nesse caso, use o modo web (`npm.cmd run web`) no Chrome ou no Edge com o YouTube já conectado.

Validação do código: `npm run typecheck`, `npm test` e `npm run build`. Os testes usam bancos temporários e não gastam cota da API.

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
