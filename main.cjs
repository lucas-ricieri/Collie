'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const sanitizeHtml = require('sanitize-html');

const APP_NAME = 'Collie';
const MAX_DOCUMENT_BYTES = 64 * 1024 * 1024;
const MAX_EXPORT_BYTES = 24 * 1024 * 1024;
const ENTRY_PATH = path.join(__dirname, 'renderer', 'index.html');
const ENTRY_URL = pathToFileURL(ENTRY_PATH).href;
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; worker-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
const approvedPaths = new Set();
let mainWindow = null;
let dirty = false;
let unsavedCount = 0;
let closing = false;
let closePromptPending = false;

app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId('com.collie.editor');

function keyForPath(filePath) {
  const normalized = path.resolve(filePath);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function requireTrustedSender(event) {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame || event.senderFrame?.url !== ENTRY_URL) {
    throw new Error('Solicitação de janela não autorizada.');
  }
}

function requireText(value, limit, name) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > limit) {
    throw new Error(`${name} inválido ou muito grande.`);
  }
  return value;
}

function safeName(value, extension) {
  const name = typeof value === 'string' ? path.basename(value) : 'Documento';
  const base = name.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim().slice(0, 100);
  return `${base || 'Documento'}${extension}`;
}

async function writeDocumentSafely(filePath, content) {
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.unlink(temporaryPath).catch(() => {});
  }
}

function sendCommand(command) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('collie:command', command);
}

function buildMenu() {
  const command = (label, accelerator, name) => ({ label, accelerator, click: () => sendCommand(name) });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '&Arquivo', submenu: [
      command('&Nova aba', 'Ctrl+N', 'new'),
      command('&Fechar aba', 'Ctrl+W', 'close-tab'),
      command('&Abrir…', 'Ctrl+O', 'open'),
      { type: 'separator' },
      command('&Salvar', 'Ctrl+S', 'save'),
      command('Salvar &como…', 'Ctrl+Shift+S', 'save-as'),
      { type: 'separator' },
      command('Exportar &HTML…', 'Ctrl+Alt+H', 'export-html'),
      command('Exportar &PDF…', 'Ctrl+Alt+P', 'export-pdf'),
      { type: 'separator' },
      { label: 'Sai&r', accelerator: 'Alt+F4', click: () => mainWindow?.close() }
    ] },
    { label: '&Editar', submenu: [
      { label: 'Desfazer', role: 'undo' }, { label: 'Refazer', role: 'redo' },
      { type: 'separator' },
      { label: 'Recortar', role: 'cut' }, { label: 'Copiar', role: 'copy' },
      { label: 'Colar', role: 'paste' }, { label: 'Selecionar tudo', role: 'selectAll' },
      { type: 'separator' }, command('&Buscar', 'Ctrl+F', 'find')
    ] },
    { label: 'E&xibir', submenu: [
      command('Alternar &modo de edição', 'Ctrl+/', 'source'),
      command('Próxima aba', 'Ctrl+Tab', 'next-tab'),
      command('Aba anterior', 'Ctrl+Shift+Tab', 'previous-tab'),
      command('Modo &foco', 'F8', 'focus'),
      command('Alternar &tema', 'Ctrl+Shift+T', 'theme'),
      { type: 'separator' },
      { label: 'Aumentar zoom', role: 'zoomIn' },
      { label: 'Diminuir zoom', role: 'zoomOut' },
      { label: 'Restaurar zoom', role: 'resetZoom' },
      { label: 'Tela cheia', role: 'togglefullscreen' }
    ] },
    { label: 'A&juda', submenu: [{ label: 'Sobre o Collie', click: () => dialog.showMessageBox(mainWindow, {
      type: 'info', title: 'Sobre o Collie', message: `Collie ${app.getVersion()}`,
      detail: 'Editor Markdown para Windows.\nProjeto independente, com código e identidade próprios.', buttons: ['OK']
    }) }] }
  ]));
}

function restrictContents(contents) {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', event => event.preventDefault());
  contents.on('will-redirect', event => event.preventDefault());
  contents.on('will-attach-webview', event => event.preventDefault());
}

function createMainWindow() {
  const appSession = session.fromPartition('persist:collie');
  appSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  appSession.setPermissionCheckHandler(() => false);
  appSession.webRequest.onHeadersReceived((details, callback) => callback({
    responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] }
  }));
  appSession.webRequest.onBeforeRequest((details, callback) => {
    const protocol = new URL(details.url).protocol;
    callback({ cancel: !['file:', 'data:'].includes(protocol) });
  });
  mainWindow = new BrowserWindow({
    width: 1280, height: 840, minWidth: 820, minHeight: 560, show: false,
    title: APP_NAME, backgroundColor: '#f5f4ef', icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), session: appSession,
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      webSecurity: true, allowRunningInsecureContent: false, spellcheck: true
    }
  });
  restrictContents(mainWindow.webContents);
  mainWindow.webContents.on('page-title-updated', event => event.preventDefault());
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('close', async event => {
    if (!dirty || closing) return;
    event.preventDefault();
    if (closePromptPending) return;
    closePromptPending = true;
    try {
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'warning', title: 'Alterações não salvas',
        message: unsavedCount > 1 ? `Há ${unsavedCount} abas com alterações não salvas.` : 'Há uma aba com alterações não salvas.',
        detail: 'Cancele e salve cada aba com Ctrl+S para manter suas alterações. Fechar agora descarta as alterações de todas as abas.',
        buttons: ['Cancelar', 'Descartar e fechar'], defaultId: 0, cancelId: 0, noLink: true
      });
      if (response === 1 && mainWindow && !mainWindow.isDestroyed()) {
        closing = true;
        mainWindow.close();
      }
    } finally { closePromptPending = false; }
  });
  mainWindow.on('closed', () => { mainWindow = null; dirty = false; closing = false; });
  mainWindow.loadFile(ENTRY_PATH).catch(error => {
    dialog.showErrorBox('Não foi possível iniciar o Collie', error.message);
    app.quit();
  });
  buildMenu();
}

const EXPORT_STYLE = `
@page{size:A4;margin:20mm}*{box-sizing:border-box}html{color-scheme:light}
body{max-width:820px;margin:40px auto;padding:0 24px;font:16px/1.7 "Segoe UI",Arial,sans-serif;color:#26332f;background:#fff;overflow-wrap:anywhere}
h1,h2,h3,h4,h5,h6{line-height:1.3;color:#192e27;margin:1.7em 0 .65em;page-break-after:avoid}h1{font-size:2.25em}h2{font-size:1.7em;border-bottom:1px solid #dce4df;padding-bottom:.3em}
a{color:#23735b}p{margin:.8em 0}pre{background:#f1f4f2;padding:18px;border-radius:8px;white-space:pre-wrap;overflow-wrap:anywhere}code,kbd{font: .9em/1.6 Consolas,monospace}code{background:#f1f4f2;padding:.15em .3em;border-radius:3px}pre code{padding:0;background:none}blockquote{border-left:3px solid #70a08c;margin:1em 0;padding:.1em 1.2em;color:#4d6257}table{border-collapse:collapse;width:100%;margin:1em 0}th,td{border:1px solid #d5dfd9;padding:9px 12px;text-align:left}th{background:#f1f4f2}img{max-width:100%;height:auto}hr{border:0;border-top:1px solid #d5dfd9;margin:2em 0}li{margin:.25em 0}input{margin-right:.5em}del{color:#647269}@media print{body{max-width:none;margin:0;padding:0}a{color:inherit}pre,blockquote,tr,img{break-inside:avoid}}
`;

function exportDocument(rawHtml, suggestedName) {
  requireText(rawHtml, MAX_EXPORT_BYTES, 'HTML');
  const clean = sanitizeHtml(rawHtml, {
    allowedTags: ['p','br','div','span','h1','h2','h3','h4','h5','h6','strong','b','em','i','s','del','u','mark','sub','sup','code','pre','kbd','blockquote','ul','ol','li','hr','a','img','table','thead','tbody','tfoot','tr','th','td','caption','details','summary','input'],
    allowedAttributes: {
      a: ['href', 'title'], img: ['src', 'alt', 'title', 'width', 'height'],
      ol: ['start'], li: ['value'], th: ['colspan','rowspan','align'], td: ['colspan','rowspan','align'],
      input: ['type','disabled','checked']
    },
    allowedSchemes: ['http', 'https', 'mailto'], allowedSchemesByTag: { img: ['data'] },
    allowProtocolRelative: false,
    transformTags: {
      img: (_tag, attrs) => ({ tagName: 'img', attribs: {
        ...attrs, src: /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(attrs.src || '') ? attrs.src : ''
      } }),
      input: (_tag, attrs) => ({ tagName: 'input', attribs: {
        type: 'checkbox', disabled: 'disabled', ...(Object.hasOwn(attrs, 'checked') ? { checked: 'checked' } : {})
      } })
    }
  });
  const title = sanitizeHtml(safeName(suggestedName, ''), { allowedTags: [], allowedAttributes: {} });
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${title}</title><style>${EXPORT_STYLE}</style></head><body>${clean}</body></html>`;
}

function registerIpc() {
  ipcMain.handle('collie:close-window', event => {
    requireTrustedSender(event);
    mainWindow.close();
  });
  ipcMain.handle('collie:open', async event => {
    requireTrustedSender(event);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Abrir documentos', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Markdown e texto', extensions: ['md','markdown','mdown','txt'] }, { name: 'Todos os arquivos', extensions: ['*'] }]
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    // Read sequentially to avoid allocating all selected buffers concurrently.
    // One unreadable file must not prevent opening the other selected documents.
    const documents = [];
    const errors = [];
    for (const selectedPath of result.filePaths) {
      const filePath = path.resolve(selectedPath);
      try {
        const handle = await fs.open(filePath, 'r');
        let buffer;
        try {
          const info = await handle.stat();
          if (!info.isFile() || info.size > MAX_DOCUMENT_BYTES) throw new Error('Selecione um arquivo de texto com até 64 MiB.');
          buffer = await handle.readFile();
          if (buffer.length > MAX_DOCUMENT_BYTES) throw new Error('O arquivo excede 64 MiB.');
        } finally { await handle.close(); }
        if (buffer.includes(0)) throw new Error('Este arquivo não parece ser texto UTF-8.');
        const content = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        approvedPaths.add(keyForPath(filePath));
        documents.push({ path: filePath, content });
      } catch (error) { errors.push({ name: path.basename(filePath), message: error.message }); }
    }
    return { canceled: false, documents, errors };
  });
  ipcMain.handle('collie:save', async (event, payload) => {
    requireTrustedSender(event);
    const content = requireText(payload?.content, MAX_DOCUMENT_BYTES, 'Documento');
    let filePath = typeof payload?.path === 'string' && payload.path.length < 4096 ? path.resolve(payload.path) : null;
    if (!filePath || payload.saveAs === true || !approvedPaths.has(keyForPath(filePath))) {
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Salvar documento', defaultPath: filePath || 'Documento.md',
        filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'Texto', extensions: ['txt'] }]
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      filePath = path.resolve(result.filePath);
    }
    await writeDocumentSafely(filePath, content);
    approvedPaths.add(keyForPath(filePath));
    return { canceled: false, path: filePath };
  });
  ipcMain.handle('collie:export-html', async (event, payload) => {
    requireTrustedSender(event);
    const html = exportDocument(payload?.html, payload?.suggestedName);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Exportar HTML', defaultPath: safeName(payload?.suggestedName, '.html'),
      filters: [{ name: 'Página HTML', extensions: ['html'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    await fs.writeFile(result.filePath, html, 'utf8');
    return { canceled: false, path: result.filePath };
  });
  ipcMain.handle('collie:export-pdf', async (event, payload) => {
    requireTrustedSender(event);
    const html = exportDocument(payload?.html, payload?.suggestedName);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Exportar PDF', defaultPath: safeName(payload?.suggestedName, '.pdf'),
      filters: [{ name: 'Documento PDF', extensions: ['pdf'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const printSession = session.fromPartition('collie-export');
    printSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    printSession.setPermissionCheckHandler(() => false);
    printSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('data:') }));
    const printWindow = new BrowserWindow({ show: false, width: 900, height: 1000,
      webPreferences: { session: printSession, javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true }
    });
    restrictContents(printWindow.webContents);
    try {
      await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const pdf = await printWindow.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
      await fs.writeFile(result.filePath, pdf);
      return { canceled: false, path: result.filePath };
    } finally { if (!printWindow.isDestroyed()) printWindow.destroy(); }
  });
  ipcMain.on('collie:title', (event, payload) => {
    try {
      requireTrustedSender(event);
      dirty = payload?.dirty === true;
      unsavedCount = Number.isSafeInteger(payload?.unsavedCount) ? Math.max(0, payload.unsavedCount) : Number(dirty);
      const name = typeof payload?.name === 'string' ? path.basename(payload.name).replace(/[\r\n\x00-\x1f]/g, '').slice(0, 150) : 'Sem título';
      mainWindow.setTitle(`${dirty ? '● ' : ''}${name || 'Sem título'} — ${APP_NAME}`);
    } catch { /* Untrusted title updates have no effect. */ }
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });
  app.whenReady().then(() => { registerIpc(); createMainWindow(); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
  app.on('window-all-closed', () => app.quit());
}
