# Collie — editor Markdown para Windows

Versão 0.2.0 do editor Markdown para Windows. Interface independente, com a imagem de border collie fornecida pelo usuário. As regras e o conhecimento de implementação estão em `AGENTS.md`.

## Abrir o aplicativo

Extraia **todo** o arquivo `Collie-Windows-x64.zip` e abra `Collie.exe` dentro da pasta extraída. Mantenha o executável junto com as outras pastas e DLLs. A versão portátil inclui o runtime e funciona offline; não exige Node.js no computador de destino.

## Recursos desta versão

- Edição visual de títulos, parágrafos, negrito, itálico, riscado, citações, links, listas, tarefas, tabelas e blocos de código.
- Cabeçalho compacto: Abrir com busca nas abas da sessão, Nova aba, nome e estado centralizados, informações do documento, menu principal e fechar janela.
- Abrir vários arquivos de uma vez, cada um em sua aba; erros individuais não impedem os demais.
- A lateral fica recolhida e serve apenas para navegar pelos títulos. Abra pelo botão de estrutura no rodapé ou pelo menu principal.
- Salvar, Salvar como, busca, modo foco, exportação e tema ficam no menu principal. O botão de informações mostra caminho, estado, palavras, caracteres, linhas, tamanho UTF-8 e modo de edição.
- Múltiplas abas na parte inferior: Novo e Abrir sempre criam uma aba; rascunhos e posição são preservados ao alternar.
- Botões de lateral/Fonte no rodapé e barra de formatação flutuante acima dele.
- Fonte com CodeMirror virtualizado, sumário virtualizado e indexação em worker.
- Alternância para o código Markdown; sumário clicável e busca com destaque.
- Abrir, salvar e salvar como arquivos Markdown UTF-8. A gravação usa arquivo temporário e substituição para reduzir o risco de sobrescrita incompleta.
- Temas claro/escuro, modo foco, contagem de palavras e tempo estimado de leitura.
- Exportação HTML e PDF com estilo próprio.
- Confirmação ao fechar uma aba alterada; fechar a janela verifica alterações de todas as abas.

Markdown continua sendo o formato do arquivo. Apenas alternar entre os modos deve preservar o conteúdo lido. **Editar no modo visual pode normalizar espaços, marcadores, tabelas e quebras de linha.** Arquivos com metadados YAML, HTML, matemática ou notas de rodapé abrem em Fonte, com confirmação antes de passar ao visual. Essa detecção é conservadora e não reconhece todas as extensões possíveis; use Fonte quando precisar preservar a sintaxe exata.

## Atalhos

| Ação | Atalho |
|---|---|
| Novo / Abrir | Ctrl+N ou Ctrl+T / Ctrl+O |
| Fechar aba / próxima aba | Ctrl+W / Ctrl+Tab |
| Aba anterior / selecionar aba | Ctrl+Shift+Tab / Alt+1–9 |
| Salvar / Salvar como | Ctrl+S / Ctrl+Shift+S |
| Negrito / Itálico | Ctrl+B / Ctrl+I |
| Inserir ou editar link | Ctrl+K |
| Buscar | Ctrl+F |
| Visual / Fonte | Ctrl+/ |
| Foco | F8 |
| Tema claro/escuro | Ctrl+Shift+T |
| Exportar HTML / PDF | Ctrl+Alt+H / Ctrl+Alt+P |
| Fechar busca / sair do foco | Esc |

No visual, digite `# ` para um título, `> ` para uma citação ou `- ` para uma lista. Use o menu da tabela para inserir ou remover linhas e colunas.

## Limites conhecidos

Esta é uma versão inicial, sem paridade completa com o Typora. Não inclui Mermaid, renderização matemática, conversão com Pandoc, biblioteca de pastas, sincronização, instalação no menu Iniciar ou associação automática de `.md`.

Não há salvamento automático nem recuperação de rascunho: use Ctrl+S. Arquivos alterados por outro programa não são monitorados. O limite de leitura/escrita é de 64 MiB por arquivo UTF-8; documentos grandes abrem em Fonte otimizada quando têm mais de 200.000 caracteres ou 3.000 quebras de linha. No modo Fonte grande, o realce de sintaxe e a quebra automática de linhas ficam desativados para reduzir o custo; linhas compridas têm rolagem horizontal. A conversão visual continua disponível com confirmação. Documentos sintéticos de 1,2 MB com 12 mil seções e de 18,3 MB foram percorridos e salvos integralmente; isso não garante o mesmo tempo para qualquer documento. O texto é tratado como UTF-8 e o BOM inicial é removido. Arquivos com codificação inválida são recusados para evitar gravar caracteres substituídos. A abertura mantém o arquivo inteiro em memória; 64 MiB é um limite aceito, não uma garantia de fluidez nesse tamanho. A exportação HTML/PDF mantém seu limite próprio de 24 MiB de HTML.

Imagens remotas são bloqueadas nesta versão offline. A resolução de caminhos relativos de imagens ao documento original não está implementada. A exportação só incorpora imagens em data URI e pode simplificar formatos especiais. Links são editáveis, mas não abrem páginas externas a partir do editor.

O executável é portátil e não tem assinatura digital, instalador ou atualização automática. Veja os resultados efetivamente exercitados em `outputs/testes-desenvolvimento.json` e, após o teste do executável, `outputs/testes-pacote.json`.

## Investigação do GNOME Text Editor

Veja [evidências e decisões](outputs/INVESTIGACAO-GNOME.md), incluindo fontes oficiais, diferenças de arquitetura e validação atual em Linux. O registro inicial está em `outputs/testes-gnome.json`; os 14 grupos atuais, incluindo o cabeçalho da referência enviada, estão em `outputs/testes-header.json`. Veja também `outputs/HEADER-COLLIE.md`. As capturas em `outputs/Collie-previa.png`, `outputs/Collie-escuro.png` e `outputs/Collie-arquivo-grande.png` mostram o código atual. Os resultados anteriores de Windows referem-se à versão anterior; esta alteração ainda não foi empacotada nem testada no Windows.

## Desenvolver e recompilar

Com Node.js e npm instalados, na pasta deste projeto:

```powershell
npm ci --include=dev
# Se a política de scripts do seu npm impedir baixar o runtime:
node node_modules/electron/install.js
npm start
```

Testar: `npm test`.

Para gerar o aplicativo Windows x64:

```powershell
npm run package
```

A saída é `releases/Collie-win32-x64/Collie.exe`. Preserve o arquivo `package-lock.json` para reproduzir as versões utilizadas.

O renderer usa Tiptap 3.32.0, ProseMirror e CodeMirror 6, compilados localmente com esbuild. O processo principal usa Electron e sanitize-html; mantém sandbox e isolamento de contexto, valida IPC e restringe o acesso a arquivos aos diálogos. Não há requisições de rede durante o uso normal. Documentação de referência: [segurança do Electron](https://www.electronjs.org/docs/latest/tutorial/security), [Tiptap Markdown](https://tiptap.dev/docs/editor/markdown).

Licenças das dependências estão em `THIRD_PARTY_LICENSES.txt` e nas distribuições incluídas. A implementação do Collie não contém arquivos do Typora.
