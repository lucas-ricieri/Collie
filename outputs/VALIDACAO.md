# Collie 0.2.0 — validação da entrega

> Registro histórico de Windows. Para a alteração de 21/10/2026, consultar `INVESTIGACAO-GNOME.md` e `testes-gnome.json`. As capturas clara/escura foram atualizadas no teste Linux. O pacote Windows abaixo não inclui as alterações posteriores.

Data: 15/10/2026. Ambiente: Windows x64, Electron 44.7.2.

## Resultado

Build e empacotamento concluídos. Os nove grupos de verificações passaram tanto no ambiente de desenvolvimento quanto no executável `Collie.exe` empacotado, sem exceções JavaScript registradas.

Foram exercitados:

- Nome Collie, imagem enviada na interface e isolamento do renderer.
- Novo/Abrir em abas independentes, restauração de rascunhos e modo Fonte, gravação da aba correta.
- Cancelamento de fechamento de aba alterada e proteção da janela quando uma aba inativa ainda tem alterações.
- Documento visual com mil parágrafos, alcançando o fim e sem scrollbar vertical duplicada da página.
- Arquivo sintético com **1.213.829 bytes e 12 mil seções**: abertura em Fonte, viewport e sumário virtualizados, navegação até o fim, edição e comparação integral do arquivo salvo.
- Busca e sumário alcançando as últimas seções desse arquivo.
- Abas e botões de lateral/Fonte no rodapé, com ferramentas flutuantes acima dele.
- Geração de PDF válido.
- Tema escuro e funcionamento dos controles inferiores e da lateral na largura mínima de 820 pixels.

A abertura do documento grande levou 98 ms na execução do pacote nesta máquina. A medição vai da solicitação de abertura à ativação da aba; não significa que todo o índice e toda a coloração de sintaxe já estavam concluídos naquele instante. O teste aguardou separadamente o sumário de 12.001 títulos e verificou o final do conteúdo. Esse resultado não é uma garantia para qualquer máquina ou documento.

## Método e limites

Os testes automatizados controlaram o Electron real com Playwright. Os diálogos de arquivo receberam respostas controladas com caminhos de teste em `work`, sem alterar documentos pessoais. Isso exercita a ponte IPC e a leitura/gravação reais, mas não equivale a uma avaliação manual dos diálogos nativos.

As capturas clara e escura foram inspecionadas. A virtualização completa do texto pertence ao modo Fonte; documentos extensos abrem nesse modo automaticamente. A conversão para visual permanece disponível com confirmação e pode ser mais custosa. Não houve teste de todos os dialetos Markdown, interrupção de energia, edição concorrente por outro aplicativo ou instalação em uma segunda máquina.

Resultados estruturados: `testes-desenvolvimento.json` e `testes-pacote.json`. Regras de manutenção: `../AGENTS.md`. Limites e instruções de uso: `../README.md`.
