# Collie — conhecimento e regras de implementação

Este documento orienta a implementação e a manutenção deste projeto. Atualize-o quando uma decisão de arquitetura ou um comportamento importante mudar. Instruções explícitas do usuário prevalecem sobre estas regras.

## Produto e requisitos aceitos

O **Collie** é um editor Markdown local para Windows, inspirado na experiência de edição do Typora. O código é independente: não copiar código, CSS, ícones ou binários do Typora. O nome anterior do protótipo era Clara; novas interfaces e distribuições devem usar Collie.

- Interface em português.
- Edição visual e edição do código Markdown.
- Cada arquivo aberto e cada documento novo cria uma nova aba, mesmo quando há alterações em outras abas. Não substituir o documento ativo nem pedir descarte ao simplesmente abrir/criar outro.
- Abas de arquivos na barra inferior, com nome, indicação de alteração e botão de fechar.
- Botões de navegação por títulos e código fonte na barra inferior. A lateral começa recolhida e contém exclusivamente títulos do documento e controle de fechar; não colocar logo, cartão de arquivo, Novo/Abrir ou tema nela.
- Cabeçalho inspirado na referência do GNOME: Abrir com menu pesquisável das abas da sessão, nova aba, título/estado centralizados, informações do documento, menu principal e fechar janela. Salvar, exportar, busca, foco e tema ficam no menu principal. A imagem Collie permanece no item de ajuda do menu e no ícone do aplicativo.
- Informações do documento incluem nome, caminho, estado, palavras, caracteres Unicode, linhas, tamanho UTF-8 e modo. Calcular estatísticas no worker; ignorar índices antigos. Fechar janela pelo cabeçalho usa IPC específico validado e a proteção já existente de alterações não salvas.
- Barra de formatação flutuante, centralizada acima da barra inferior, conforme as referências do usuário.
- Logo: imagem de border collie fornecida pelo usuário, preservada em `assets/collie-logo.jpg`. O ícone Windows é derivado dessa imagem. Não substituir a identidade por uma imagem gerada sem solicitação.
- Temas claro/escuro, foco, sumário, busca, contagem de palavras, abrir/salvar Markdown e exportar HTML/PDF.

## Estrutura do projeto

| Caminho | Responsabilidade |
|---|---|
| `main.cjs` | Processo principal Electron: janela, menus, diálogos, acesso a arquivos, IPC e exportação |
| `preload.cjs` | Ponte restrita `window.desktop` entre renderer e processo principal |
| `renderer/index.html` | Estrutura e controles da interface |
| `renderer/styles.css` | Temas, editor, rolagem, abas inferiores e ferramentas flutuantes |
| `renderer/app.js` | Estado dos documentos/abas, edição visual, ações, busca, sumário e integração |
| `renderer/source-editor.js` | Editor de código CodeMirror, viewport virtual, seleção e histórico |
| `renderer/document-worker.js` | Indexação do texto fora da thread da interface: títulos e contagem |
| `assets/` | Imagem original e ícone Windows |
| `scripts/build.mjs` | Bundle do renderer com esbuild |
| `scripts/package.mjs` | Aplicativo portátil Windows x64 com Electron Packager |
| `scripts/create-icon.ps1` | Conversão determinística da imagem enviada para ícone de múltiplos tamanhos |
| `tests/editor.test.cjs` | Testes integrados no Electron real |
| `work/` | Arquivos temporários, perfis de teste, documentos sintéticos e diagnósticos |
| `outputs/` | Capturas, resultados de testes e arquivos de entrega |
| `releases/` | Diretórios de aplicativos empacotados |

`node_modules`, `work` e `releases` não devem entrar no Git. Não editar `renderer/app.bundle.js` manualmente: ele é gerado. O arquivo `renderer/document-worker.js` é carregado separadamente e deve estar presente no pacote final.

## Arquitetura e dependências

- Electron: janela e integração local com Windows.
- Tiptap 3 / ProseMirror: documento estruturado, transações e edição visual.
- Extensão Markdown do Tiptap: parse/serialização para os recursos suportados.
- CodeMirror 6: editor de código com renderização apenas da região visível.
- Web Worker: indexação de texto sem bloquear a interface.
- sanitize-html: saneamento das exportações.
- esbuild: compilação local; Electron Packager: distribuição portátil.

As versões exatas estão em `package.json` e `package-lock.json`. Preserve o lockfile. Consulte as APIs da versão instalada ou a documentação oficial antes de mudar integrações; não adivinhe assinaturas ou misture exemplos de versões incompatíveis.

## Regras de documentos e abas

1. Cada aba mantém identidade, caminho, nome, Markdown atual, último conteúdo salvo, modo, seleção, histórico e posição de rolagem.
2. Ao trocar de aba, conservar alterações não salvas e restaurar o estado da aba escolhida. Não disparar leitura do disco apenas para alternar abas.
3. Ao fechar uma aba alterada, oferecer cancelar ou descartar. Cancelar deve preservar integralmente a aba.
4. Ao fechar a janela, verificar alterações em **todas** as abas, inclusive as inativas. O processo principal recebe o estado agregado de alterações.
5. Salvar deve usar um snapshot da aba que iniciou a operação. Se o usuário alternar abas durante um diálogo/operação, não atribuir o caminho nem o resultado a outra aba.
6. Se houver edição durante uma gravação, marcar como salvo somente o snapshot gravado; mudanças posteriores continuam pendentes.
7. Nunca truncar conteúdo para melhorar desempenho. A visualização pode ser virtualizada; o arquivo completo continua disponível para busca, edição e gravação.
8. Alternar Visual/Fonte sem editar não deve normalizar nem alterar o Markdown. Transações auxiliares de inicialização do Tiptap não contam como edição do usuário.
9. Edição visual pode normalizar sintaxe Markdown. Arquivos com sintaxe especial devem abrir em Fonte e avisar antes de uma conversão potencialmente destrutiva.
10. Manter o histórico de cada editor/aba sempre que o documento subjacente não mudou. Mudanças no código que exigem novo parse visual podem reconstruir o histórico visual; não perder o texto.

## Regras de desempenho e rolagem

O problema relatado pelo usuário envolvia documentos extensos e barras de rolagem sobrepostas. O protótipo também reparseava o Markdown inteiro em cada edição no modo Fonte.

- `html`, `body`, `.app-shell` e `.workspace` devem permanecer limitados à altura da janela e não gerar rolagem da página.
- No visual, `.writing-surface` controla a rolagem do documento.
- Na Fonte, a rolagem pertence ao viewport do CodeMirror; o contêiner externo não deve criar outra scrollbar vertical.
- Manter `min-height: 0` e dimensões limitadas nos contêineres flexíveis. Não voltar a expandir uma textarea à altura de todo o documento.
- A barra inferior e a barra flutuante não fazem parte da altura rolável do texto. Reservar espaço inferior para alcançar o último bloco sem ficar encoberto.
- Não executar parse completo do Markdown na thread da interface para atualizar palavras/sumário em cada tecla. Usar o worker e debounce.
- Respostas do worker precisam ser associadas à identidade da aba e à geração do texto. Ignorar respostas antigas e respostas de abas fechadas.
- O sumário também é virtualizado: montar apenas as linhas próximas do viewport, sem criar milhares de botões de uma vez.
- No modo Fonte grande, desativar parser Markdown, realce, correspondência de colchetes, realce de ocorrências e quebra automática de linhas; linhas extensas têm rolagem horizontal. Reconfigurar com `Compartment` preservando histórico; alterações iniciadas pelo listener de edição devem ser aplicadas após a atualização do CodeMirror.
- Atualmente, documentos com **mais de 200.000 caracteres ou mais de 3.000 quebras de linha** abrem em Fonte otimizada. O usuário pode solicitar o visual, com explicação do custo. Esses valores são limites de estratégia de apresentação, não limites de conteúdo nem garantias universais de desempenho.
- Não chamar o sistema de carregamento de dados infinito: os arquivos são locais. O comportamento implementado é rolagem/DOM virtualizados no modo Fonte e no sumário.
- Testar início, meio e fim, navegação por busca/sumário, troca de abas e gravação integral. Não validar desempenho apenas com a página de boas-vindas.

## Regras de interface

- Manter a identidade Collie no título, logo, menus, metadados, executável e ZIP.
- Preservar a imagem fornecida como fonte da identidade; conversões para formatos de ícone não devem redesenhar o animal.
- Controles precisam ter rótulos acessíveis, foco por teclado e estado ativo claro.
- As abas inferiores devem suportar navegação por teclado e fechamento individual.
- Menus flutuantes da barra inferior devem abrir para cima e permanecer dentro da janela.
- Não deixar atalhos duplicados no menu Electron e em handlers do renderer: isso pode abrir dois diálogos ou executar a ação duas vezes.
- Atalhos principais: Ctrl+N ou Ctrl+T nova aba; Ctrl+O abrir; Ctrl+S salvar; Ctrl+Shift+S salvar como; Ctrl+W fechar aba; Ctrl+Tab/Ctrl+Shift+Tab alternar abas; Ctrl+/ alternar Fonte; Ctrl+F buscar; F8 foco; Ctrl+Shift+T tema.
- Verificar tema claro, tema escuro e largura mínima da janela. Não sacrificar os botões de lateral/Fonte nem as abas no layout menor.

## Regras do Electron e dos arquivos

- Manter `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` e `webSecurity: true`.
- Não expor `ipcRenderer`, APIs genéricas de arquivo, execução de comandos ou módulos Node ao renderer.
- Validar origem, janela e frame de cada chamada IPC. Usar apenas canais e payloads específicos.
- Arquivos para gravação devem ter sido abertos/escolhidos pelo usuário por diálogo; um caminho arbitrário enviado pelo renderer não concede autorização.
- Manter o salvamento por temporário no mesmo diretório e substituição, com limpeza em caso de falha. Não sobrescrever silenciosamente com conteúdo parcial.
- Não executar JavaScript, HTML, comandos ou plugins contidos nos documentos Markdown.
- Manter CSP, bloqueio de navegação e de novas janelas. O worker local exige `worker-src 'self'`; não liberar scripts remotos para fazê-lo funcionar.
- Exportação HTML/PDF passa por saneamento. A janela de impressão permanece isolada e sem execução de scripts.
- Não adicionar serviços externos, uploads, telemetria ou sincronização implicitamente. O funcionamento normal é local/offline.

## Testar e entregar

Preparação:

```powershell
npm ci --include=dev
# Se o npm não executar a instalação do runtime Electron:
node node_modules/electron/install.js
```

Desenvolvimento e validação:

```powershell
npm run build
node tests/editor.test.cjs
npm start
```

Empacotar e testar o artefato real:

```powershell
npm run package
$env:COLLIE_TEST_EXE = (Resolve-Path 'releases/Collie-win32-x64/Collie.exe').Path
node tests/editor.test.cjs
Remove-Item Env:COLLIE_TEST_EXE
```

- Os testes devem usar documentos temporários em `work`, nunca alterar documentos pessoais do usuário.
- Diálogos podem ser substituídos por respostas controladas nos testes; documentar que isso não é validação manual do diálogo nativo.
- Exercitar abas novas, rascunhos em abas inativas, fechar/cancelar, salvar a aba correta, modo Fonte, tema, barra inferior e exportação.
- O teste adicional de 21/10/2026 lê e grava um arquivo UTF-8 de 18.256.046 bytes, verifica recuperação da rolagem/histórico ao trocar de abas, busca no fim, seleção múltipla com erro parcial, limite de 64 MiB, UTF-8 inválido, Ctrl+T, clique do meio e passagem ao modo grande durante a edição. Resultado inicial em `outputs/testes-gnome.json`; com o novo cabeçalho, resultado atual em `outputs/testes-header.json` (14 grupos, menus, informações, navegação e fechamento pelo cabeçalho), atualmente apenas Linux/desenvolvimento; preservar a distinção dos resultados Windows antigos.
- O teste de regressão atual cria um documento de aproximadamente 1,2 MB com 12 mil seções, percorre o fim e compara o arquivo salvo inteiro. Também verifica mil parágrafos no visual e ausência de rolagem duplicada.
- Medições em uma máquina e arquivo sintético são evidência localizada, não promessa de desempenho em qualquer arquivo.
- Conferir visualmente as capturas de tela e testar o executável empacotado antes de afirmar que a versão Windows está pronta.
- Uma entrega Windows contém o diretório completo do aplicativo, não apenas `Collie.exe`. Preservar DLLs, recursos e avisos de terceiros.
- Atualizar README, resultados de validação, licenças de novas dependências e este documento quando necessário.

## Limites conhecidos a considerar

- O limite atual de leitura/escrita no processo principal é de 64 MiB por arquivo, tratado como texto UTF-8 estrito; o BOM inicial é removido. O diálogo permite seleção múltipla e retorna `documents` e `errors`; cada sucesso cria uma aba e os erros são apresentados juntos. O arquivo completo permanece na memória; não há leitura sob demanda do disco. Exportação mantém seu limite de 24 MiB de HTML.
- Não há salvamento automático, recuperação após encerramento, monitoramento de alterações externas ou sincronização.
- Não há equivalência completa de dialetos Markdown. Fórmulas, Mermaid, Pandoc e biblioteca de pastas ainda não estão implementados.
- Imagens remotas são bloqueadas. Caminhos de imagens relativos ao documento original ainda não são resolvidos automaticamente.
- A exportação incorpora apenas imagens em data URI e usa estilo próprio.
- A distribuição é portátil, sem assinatura digital, instalador ou atualização automática.
- Estes limites não devem ser removidos da documentação sem implementação e validação correspondentes.

## Como registrar decisões e comunicar o resultado

Separar fatos observados, decisões de projeto e hipóteses. O REA foi usado na investigação inicial do Typora; ferramentas comuns de inspeção ou testes do Collie não devem ser apresentados como Evidence do REA. Para manutenção deste código próprio, usar ferramentas normais de desenvolvimento.

Ao concluir uma mudança, informar o comportamento alterado, os testes realmente executados, o caminho do artefato e limitações relevantes. Não declarar um teste ou empacotamento concluído quando estiver apenas planejado.
