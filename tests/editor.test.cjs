const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const { _electron } = require('playwright-core');
const root = path.resolve(__dirname, '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const folder = path.join(root, 'work', 'collie-test');
  await fs.mkdir(folder, { recursive: true });
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const packaged = process.env.COLLIE_TEST_EXE;
  const app = await _electron.launch({
    executablePath: packaged || path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [...(packaged ? [] : [root]), `--user-data-dir=${path.join(folder, packaged ? 'packaged-profile' : 'dev-profile')}`],
    cwd: root, env, timeout: 45000,
  });
  const results = [];
  const errors = [];
  const pass = message => { results.push(message); console.log('PASS', message); };
  try {
    const page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('.tiptap');
    await app.evaluate(({ dialog }) => {
      globalThis.testDialogs = { open: [], save: [], messages: [] };
      dialog.showOpenDialog = async () => globalThis.testDialogs.open.shift() || { canceled: true };
      dialog.showSaveDialog = async () => globalThis.testDialogs.save.shift() || { canceled: true };
      dialog.showMessageBox = async (_win, options) => { globalThis.testDialogs.messages.push(options); return { response: 0 }; };
    });
    const command = name => app.evaluate(({ BrowserWindow }, name) => BrowserWindow.getAllWindows()[0].webContents.send('collie:command', name), name);
    const open = async (name, content) => {
      const filePath = path.join(folder, name);
      await fs.writeFile(filePath, content, 'utf8');
      await app.evaluate((_, filePath) => globalThis.testDialogs.open.push({ canceled: false, filePaths: [filePath] }), filePath);
      await command('open');
      await page.waitForFunction(name => document.querySelector('#file-name')?.textContent === name, name);
      return filePath;
    };
    const tabs = page.locator('.document-tab');
    assert.equal(await tabs.count(), 1);
    assert.equal(await page.title(), 'Boas-vindas.md — Collie');
    assert.equal(await page.locator('.brand-logo').getAttribute('src'), '../assets/collie-logo.jpg');
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
    pass('Collie inicia com a logo enviada, uma aba e renderer isolado');

    const firstPath = await open('primeiro.md', '# Primeiro\n\nConteúdo original.\n');
    assert.equal(await tabs.count(), 2);
    await command('source');
    await page.locator('#source-editor').waitFor({ state: 'visible' });
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText('# Primeiro alterado\n\nRascunho A preservado.\n');
    await command('new');
    await page.waitForFunction(() => document.querySelectorAll('.document-tab').length === 3);
    assert.equal(await page.locator('#app-dialog[open]').count(), 0);
    await page.locator('.tiptap').click();
    await page.keyboard.insertText('Rascunho B preservado.');
    await page.locator('.document-tab').filter({ hasText: 'primeiro.md' }).locator('.tab-select').click();
    await page.locator('#source-editor').waitFor({ state: 'visible' });
    assert.ok((await page.locator('.cm-content').innerText()).includes('Rascunho A preservado.'));
    await command('save');
    await page.waitForFunction(() => document.querySelector('.document-tab.active .tab-dirty')?.hidden);
    assert.equal(await fs.readFile(firstPath, 'utf8'), '# Primeiro alterado\n\nRascunho A preservado.\n');
    pass('Novo e Abrir criam abas; alternar mantém rascunhos, modo Fonte e salva a aba correta');

    await tabs.nth(2).locator('.tab-close').click();
    await page.locator('#app-dialog[open]').waitFor();
    await page.locator('#dialog-cancel').click();
    assert.equal(await tabs.count(), 3);
    await tabs.nth(2).locator('.tab-select').click();
    assert.ok((await page.locator('.tiptap').innerText()).includes('Rascunho B preservado.'));
    await page.locator('.document-tab').filter({ hasText: 'primeiro.md' }).locator('.tab-select').click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await pause(100);
    assert.equal(await app.evaluate(() => globalThis.testDialogs.messages.length), 1);
    assert.ok((await app.evaluate(() => globalThis.testDialogs.messages[0].message)).includes('aba'));
    pass('Cancelar fechamento conserva aba alterada; janela verifica alterações em todas as abas');

    await open('visual-longo.md', '# Documento visual\n\n' + Array.from({ length: 1000 }, (_, i) => `Parágrafo ${i + 1}. Texto para testar a rolagem do documento visual sem áreas de rolagem sobrepostas.\n\n`).join('') + 'FINAL DO DOCUMENTO VISUAL');
    await page.locator('.tiptap').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight + 2), false);
    assert.equal(await page.evaluate(() => document.body.scrollHeight > innerHeight + 2), false);
    await page.locator('#writing-surface').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await pause(100);
    assert.ok(await page.locator('.tiptap p').last().isVisible());
    const lastBox = await page.locator('.tiptap p').last().boundingBox();
    assert.ok(lastBox.y < (await page.viewportSize()?.height || 1500));
    pass('Mil parágrafos no visual: apenas rolagem do documento, sem scrollbar de página duplicada');

    const large = '# Arquivo grande\n\n' + Array.from({ length: 12000 }, (_, i) => `## Seção ${i + 1}\n\nConteúdo da seção ${i + 1}: notas, tarefas e informações de um documento extenso.\n\n`).join('') + '\nFIM DO ARQUIVO GRANDE\n';
    const start = Date.now();
    const largePath = await open('grande.md', large);
    await page.locator('#source-editor').waitFor({ state: 'visible' });
    const openMs = Date.now() - start;
    await page.waitForFunction(() => Number(document.querySelector('#heading-count').textContent) === 12001);
    assert.ok(await page.locator('#outline button').count() < 80);
    assert.ok(await page.locator('.cm-line').count() < 300);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.waitForFunction(() => document.querySelector('.cm-content').textContent.includes('FIM DO ARQUIVO GRANDE'));
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight + 2), false);
    assert.equal(await page.locator('#writing-surface').evaluate(el => el.scrollHeight > el.clientHeight + 2), false);
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('EDITADO NO FINAL');
    await command('save');
    await page.waitForFunction(() => document.querySelector('.document-tab.active .tab-dirty')?.hidden);
    assert.equal(await fs.readFile(largePath, 'utf8'), large + '\nEDITADO NO FINAL');
    pass(`Arquivo de ${Buffer.byteLength(large)} bytes e 12 mil seções abre em ${openMs} ms; rolagem virtual alcança o fim sem truncar e salva o arquivo inteiro`);

    await command('find');
    await page.locator('#find-input').fill('Seção 11999');
    await page.waitForFunction(() => !document.querySelector('#find-count').textContent.includes('Nenhum'));
    assert.ok((await page.locator('.cm-content').innerText()).includes('Seção 11999'));
    await command('find-close');
    await page.locator('#outline').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await pause(100);
    assert.ok((await page.locator('#outline').innerText()).includes('Seção 12000'));
    pass('Busca e sumário virtualizados alcançam as últimas seções do arquivo grande');

    const tabBefore = await tabs.count();
    await app.evaluate((_, firstPath) => globalThis.testDialogs.open.push({ canceled: false, filePaths: [firstPath] }), firstPath);
    await command('open');
    await page.waitForFunction(count => document.querySelectorAll('.document-tab').length === count + 1, tabBefore);
    await page.locator('.tiptap').waitFor({ state: 'visible' });
    const bottom = await page.locator('.bottom-bar').boundingBox();
    const toolbar = await page.locator('.formatbar').boundingBox();
    assert.ok(toolbar.y + toolbar.height < bottom.y);
    assert.ok(await page.locator('.bottom-bar #source-mode').count());
    assert.ok(await page.locator('.bottom-bar #sidebar-toggle').count());
    await page.locator('#sidebar-toggle').click();
    assert.ok(await page.locator('body').evaluate(el => el.classList.contains('sidebar-hidden')));
    await page.locator('#sidebar-toggle').click();
    pass('Abas e atalhos de lateral/fonte no rodapé; ferramentas flutuam acima dele');

    const pdfPath = path.join(folder, 'collie-exportado.pdf');
    await fs.unlink(pdfPath).catch(() => {});
    await app.evaluate((_, filePath) => globalThis.testDialogs.save.push({ canceled: false, filePath }), pdfPath);
    const pdfResult = await page.evaluate(() => window.desktop.exportPdf({ html: document.querySelector('.tiptap').innerHTML, suggestedName: 'Collie.pdf' }));
    assert.equal(pdfResult.canceled, false);
    assert.equal((await fs.readFile(pdfPath)).subarray(0, 5).toString(), '%PDF-');
    pass('Exportação PDF continua funcional');

    await page.locator('.document-tab').first().locator('.tab-select').click();
    await page.locator('#toast').waitFor({ state: 'hidden', timeout: 7000 });
    await page.locator('#writing-surface').evaluate(el => { el.scrollTop = 0; });
    await page.evaluate(() => document.activeElement?.blur());
    if (await page.locator('body').getAttribute('data-theme') !== 'light') await command('theme');
    await page.screenshot({ path: path.join(root, 'outputs', 'Collie-previa.png') });
    await command('theme');
    await page.screenshot({ path: path.join(root, 'outputs', 'Collie-escuro.png') });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(820, 650));
    await pause(150);
    await page.locator('#sidebar-toggle').click();
    await page.locator('#sidebar-toggle').click();
    await pause(250);
    assert.ok((await page.locator('.sidebar').boundingBox()).x >= -1);
    assert.ok(await page.locator('.bottom-bar #source-mode').isVisible());
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight + 2), false);
    pass('Tema escuro e janela mínima mantêm os controles inferiores e a lateral funcionais');
    assert.deepEqual(errors, []);
    const result = { date: new Date().toISOString(), packaged: !!packaged, checks: results, errors, largeBytes: Buffer.byteLength(large), openMs };
    await fs.writeFile(path.join(root, 'outputs', packaged ? 'testes-pacote.json' : 'testes-desenvolvimento.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
