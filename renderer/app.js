import { Editor, Extension, generateHTML } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { TableKit } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import { Plugin, PluginKey, EditorState as VisualState } from '@tiptap/pm/state';
import { createSourceEditor } from './source-editor.js';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const $ = (selector) => document.querySelector(selector);
const desktop = window.desktop;
const source = createSourceEditor($('#source-editor'));
const surface = $('#writing-surface');
const searchKey = new PluginKey('collieSearch');
let sequence = 0;
const tabs = [];
let operationBusy = false;
let state = {};
let indexGeneration = 0;
const indexWorker = new Worker(new URL('./document-worker.js', location.href));
indexWorker.onmessage = ({ data }) => {
  const tab = tabs.find(tab => tab.id === data.id);
  if (!tab || tab.generation !== data.generation) return;
  tab.index = data;
  if (tab === state) { showStatistics(); updateOutline(); }
};
let editor;
let refreshTimer;
let toastTimer;
let dialogResolve;

const WELCOME = `# Um espaço para suas ideias

Comece com uma página em branco. Ou fique um pouco por aqui: este é o **Collie**, seu editor de Markdown.

## Escreva no seu ritmo

O texto ganha forma enquanto você escreve. Use a barra flutuante abaixo para formatar ou experimente os atalhos do Markdown: \`#\` para um título, \`>\` para uma citação e \`-\` para uma lista. Digite um espaço depois do símbolo.

> Escrever é dar às ideias um lugar para ficar.

Troque para **Fonte** quando quiser cuidar de cada detalhe do arquivo. Seu documento continua sendo um simples arquivo \`.md\`.

## Uma pequena lista

- [x] Encontrar um lugar tranquilo
- [ ] Anotar a primeira ideia
- [ ] Deixar o texto crescer

## Pronto para começar

Crie um documento com **Ctrl+N**, abra suas notas com **Ctrl+O** e salve com **Ctrl+S**. A estrutura à esquerda acompanha os títulos do texto.

Quando precisar de silêncio, ative o modo **Foco**.
`;

const SearchDecorations = Extension.create({
  name: 'collieSearch',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: searchKey,
      state: {
        init: () => DecorationSet.empty,
        apply(transaction, decorations) {
          const value = transaction.getMeta(searchKey);
          if (value) return DecorationSet.create(transaction.doc, value.map((match, index) =>
            Decoration.inline(match.from, match.to, {
              class: `search-match${index === state.searchIndex ? ' current' : ''}`,
            })));
          return decorations.map(transaction.mapping, transaction.doc);
        },
      },
      props: { decorations: (editorState) => searchKey.getState(editorState) },
    })];
  },
});

function extensions() {
  return [
    StarterKit.configure({
      // Retain all six heading levels in imported documents; the toolbar offers H1–H3.
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    Image.configure({ inline: false, allowBase64: false }),
    Markdown.configure({ markedOptions: { gfm: true, breaks: false } }),
    SearchDecorations,
  ];
}

function makeEditor(markdown) {
  if (editor) {
    const doc = editor.schema.nodeFromJSON(editor.markdown.parse(markdown));
    editor.view.updateState(VisualState.create({ doc, plugins: editor.state.plugins }));
    editor.view.dispatch(editor.state.tr.setMeta('preventUpdate', true).setMeta('addToHistory', false));
    state.visualRaw = markdown;
    return;
  }
  $('#visual-editor').replaceChildren();
  editor = new Editor({
    element: $('#visual-editor'),
    extensions: extensions(),
    content: markdown,
    contentType: 'markdown',
    injectCSS: false,
    editorProps: {
      attributes: { class: 'tiptap', 'aria-label': 'Editor visual de Markdown', role: 'textbox', 'aria-multiline': 'true', lang: 'pt-BR', spellcheck: 'true' },
      handleClick(_view, _position, event) {
        // Editing a link must never navigate away from the document.
        if (event.target.closest?.('a')) { event.preventDefault(); return true; }
        return false;
      },
    },
    onUpdate({ editor: activeEditor }) {
      if (state.source) return;
      state.raw = activeEditor.getMarkdown();
      state.special = hasSpecialSyntax(state.raw);
      state.visualRaw = state.raw;
      updateDirty();
      scheduleRefresh();
    },
    onSelectionUpdate: () => updateToolbar(),
    onTransaction: ({ transaction }) => { if (!transaction.docChanged) updateToolbar(); },
  });
  // Tiptap appends an empty paragraph after a final table/blockquote/code block
  // on its first transaction. Initialize that affordance silently: merely
  // focusing or searching a freshly loaded document must not serialize it.
  editor.view.dispatch(editor.state.tr.setMeta('preventUpdate', true).setMeta('addToHistory', false));
}

function basename(path) { return path?.split(/[\\/]/).pop() || 'Sem título.md'; }
function stem(name) { return name.replace(/\.(md|markdown|mdown|txt)$/i, '') || 'Documento'; }
function escaped(text) { return String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
function readSetting(key) { try { return localStorage.getItem(key); } catch { return null; } }
function writeSetting(key, value) { try { localStorage.setItem(key, value); } catch { /* Private browser sessions may disallow storage. */ } }

function hasSpecialSyntax(markdown) {
  // A conservative guard protects content outside this editor's Markdown schema.
  // Fenced and inline code are excluded so examples of HTML/math stay editable.
  let fence = null;
  const outsideCode = markdown.split(/\r?\n/).map((line) => {
    const match = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (match) {
      if (!fence) fence = match[1];
      else if (match[1][0] === fence[0] && match[1].length >= fence.length) fence = null;
      return '';
    }
    return fence ? '' : line;
  }).join('\n').replace(/(`+)[\s\S]*?\1/g, '');
  return /^(?:\uFEFF)?---\s*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/.test(markdown)
    || /^\s*\[\^[^\]]+\]:/m.test(outsideCode)
    || /\[\^[^\]]+\]/.test(outsideCode)
    || /<\/?[a-z][^>]*>|<!--[\s\S]*?-->/i.test(outsideCode)
    || /(?:^|[^\\])\$\$|(?:^|[^\\])\$[^\s$][^\n$]*\$/.test(outsideCode)
    || /^\s*(?:::|import\s|export\s)/m.test(outsideCode);
}

function isLargeDocument(content) {
  return content.length > 200000 || (content.match(/\n/g)?.length || 0) > 3000;
}

function stashActiveTab() {
  if (!state.id) return;
  if (state.source) state.codeScrollTop = source.scrollTop;
  else state.scrollTop = surface.scrollTop;
  if (state.source) { state.codeState = source.snapshot; state.codeRaw = state.raw; }
  else { state.visualState = editor.state; state.visualRaw = state.raw; }
}

function activateTab(id) {
  const tab = tabs.find(tab => tab.id === id);
  if (!tab || tab === state) return;
  stashActiveTab();
  clearTimeout(refreshTimer);
  state = tab;
  state.focus = document.body.classList.contains('focus-mode');
  state.searchMatches = [];
  state.searchIndex = -1;
  $('#find-input').value = '';
  $('#find-bar').hidden = true;
  if (state.codeState && state.codeRaw === state.raw) source.restore(state.codeState);
  else { source.load(state.raw, state.large); state.codeRaw = state.raw; }
  if (!editor) makeEditor('');
  if (!state.source) {
    if (state.visualState && state.visualRaw === state.raw) editor.view.updateState(state.visualState);
    else makeEditor(state.raw);
  }
  applyMode(); updateDirty(); refreshDocument();
  if (state.source) source.focus(); else editor.commands.focus();
  const strip = $('#document-tabs');
  const activeBounds = strip.querySelector('.active').getBoundingClientRect();
  const stripBounds = strip.getBoundingClientRect();
  if (activeBounds.right > stripBounds.right) strip.scrollLeft += activeBounds.right - stripBounds.right;
  else if (activeBounds.left < stripBounds.left) strip.scrollLeft -= stripBounds.left - activeBounds.left;
  requestAnimationFrame(() => {
    if (tab !== state) return;
    surface.scrollTop = state.scrollTop || 0;
    source.scrollTop = state.codeScrollTop || 0;
  });
}

function loadDocument(content, path = null, name = null) {
  const large = isLargeDocument(content);
  const special = large ? false : hasSpecialSyntax(content);
  const tab = {
    id: ++sequence, documentId: sequence, raw: content, saved: content, path,
    name: name || (path ? basename(path) : `Sem título ${sequence}.md`),
    large, special, source: special || large, dirty: false,
    searchMatches: [], searchIndex: -1, scrollTop: 0, codeScrollTop: 0,
  };
  tabs.push(tab);
  activateTab(tab.id);
  if (large) toast('Documento grande aberto em Fonte com rolagem otimizada.');
  else if (special) toast('Arquivo aberto em Fonte para preservar sua sintaxe especial.');
}

function renderTabs() {
  const list = $('#document-tabs');
  const existing = new Map([...list.children].map(el => [Number(el.dataset.tabId), el]));
  for (const tab of tabs) {
    let row = existing.get(tab.id);
    if (!row) {
      row = document.createElement('div'); row.className = 'document-tab'; row.dataset.tabId = tab.id;
      const select = document.createElement('button'); select.className = 'tab-select'; select.role = 'tab';
      select.id = `document-tab-${tab.id}`; select.setAttribute('aria-controls', 'writing-surface');
      const dot = document.createElement('span'); dot.className = 'tab-dirty'; dot.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span'); label.className = 'tab-label';
      select.append(dot, label); select.addEventListener('click', () => activateTab(tab.id));
      const close = document.createElement('button'); close.className = 'tab-close'; close.textContent = '×';
      close.addEventListener('click', () => closeTab(tab.id).catch(reportError));
      row.addEventListener('auxclick', event => {
        if (event.button === 1) { event.preventDefault(); closeTab(tab.id).catch(reportError); }
      });
      row.append(select, close); list.append(row);
    }
    existing.delete(tab.id);
    row.classList.toggle('active', tab === state);
    row.querySelector('.tab-label').textContent = tab.name;
    row.querySelector('.tab-dirty').hidden = !tab.dirty;
    row.querySelector('.tab-select').title = tab.path || tab.name;
    row.querySelector('.tab-select').setAttribute('aria-selected', String(tab === state));
    row.querySelector('.tab-select').tabIndex = tab === state ? 0 : -1;
    row.querySelector('.tab-close').setAttribute('aria-label', `Fechar ${tab.name}`);
  }
  existing.forEach(row => row.remove());
  $('#writing-surface').setAttribute('role', 'tabpanel');
  $('#writing-surface').setAttribute('aria-labelledby', `document-tab-${state.id}`);
}

async function closeTab(id = state.id) {
  if (operationBusy) return;
  const tab = tabs.find(tab => tab.id === id);
  if (!tab) return;
  if (tab.dirty && !await ask({ title: 'Fechar esta aba?', description: `Há alterações não salvas em “${tab.name}”.`, confirm: 'Descartar e fechar', cancel: 'Voltar ao texto' })) return;
  const position = tabs.indexOf(tab);
  if (tab === state) stashActiveTab();
  tabs.splice(position, 1);
  if (!tabs.length) { state = {}; loadDocument(''); }
  else if (tab === state) { state = {}; activateTab(tabs[Math.min(position, tabs.length - 1)].id); }
  else updateDirty();
  renderTabs();
  if (state.source) source.focus(); else editor.commands.focus();
}

$('#document-tabs').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  let index = tabs.indexOf(state);
  if (event.key === 'Home') index = 0;
  else if (event.key === 'End') index = tabs.length - 1;
  else index = (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  activateTab(tabs[index].id);
  $(`#document-tab-${state.id}`).focus();
});

function updateDirty() {
  state.dirty = state.raw !== state.saved;
  $('#file-name').textContent = state.name;
  $('#file-name').title = state.path || state.name;
  $('#file-subtitle').textContent = state.path ? (state.dirty ? 'Alterações não salvas' : 'Salvo no dispositivo') : 'Rascunho';
  $('#file-subtitle').title = state.path || 'Este documento ainda não foi salvo em um arquivo.';
  $('#dirty-dot').hidden = !state.dirty;
  $('#save-status-dot').classList.toggle('dirty', state.dirty);
  $('#save-status').textContent = state.dirty ? 'Alterações não salvas' : state.path ? 'Salvo' : 'Pronto para escrever';
  document.title = `${state.dirty ? '● ' : ''}${state.name} — Collie`;
  renderTabs();
  if ($('#open-menu').open) renderOpenDocuments();
  if ($('#document-info').open) updateDocumentInfo();
  if (desktop?.setTitle) Promise.resolve(desktop.setTitle({ name: state.name, dirty: tabs.some(tab => tab.raw !== tab.saved), unsavedCount: tabs.filter(tab => tab.raw !== tab.saved).length })).catch(() => {});
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshDocument, state.large ? 450 : 180);
}

function showStatistics() {
  const words = state.index?.words || 0;
  $('#word-count').textContent = `${words.toLocaleString('pt-BR')} ${words === 1 ? 'palavra' : 'palavras'}`;
  $('#reading-time').textContent = `${Math.max(1, Math.ceil(words / 200))} min de leitura`;
  if ($('#document-info').open) updateDocumentInfo();
}

function updateDocumentInfo() {
  const current = state.indexedRaw === state.raw && state.index?.generation === state.generation;
  $('#info-name').textContent = state.name;
  $('#info-path').textContent = state.path || 'Ainda não salvo em arquivo';
  $('#info-status').textContent = state.dirty ? 'Alterações não salvas' : state.path ? 'Salvo' : 'Rascunho';
  for (const [field, value] of [['words', state.index?.words], ['characters', state.index?.characters], ['lines', state.index?.lines]]) {
    $(`#info-${field}`).textContent = current ? value.toLocaleString('pt-BR') : 'Calculando…';
  }
  $('#info-size').textContent = current ? `${(state.index.bytes / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KiB` : 'Calculando…';
  $('#info-mode').textContent = state.source ? (state.large ? 'Fonte otimizada' : 'Fonte Markdown') : 'Visual';
}

function renderOpenDocuments() {
  const query = $('#open-tab-search').value.toLocaleLowerCase('pt-BR');
  const list = $('#open-documents');
  const fragment = document.createDocumentFragment();
  for (const tab of tabs.filter(tab => `${tab.name} ${tab.path || ''}`.toLocaleLowerCase('pt-BR').includes(query))) {
    const button = document.createElement('button');
    button.className = 'open-document';
    button.title = tab.path || 'Rascunho nesta sessão';
    button.setAttribute('aria-current', String(tab === state));
    const label = document.createElement('span'); label.textContent = tab.name;
    const status = document.createElement('span'); status.className = 'open-document-status';
    status.textContent = tab.dirty ? 'Alterado' : tab === state ? 'Atual' : tab.path ? 'Salvo' : 'Rascunho';
    button.append(label, status);
    button.addEventListener('click', () => { $('#open-menu').open = false; activateTab(tab.id); });
    fragment.append(button);
  }
  if (!fragment.childNodes.length) {
    const empty = document.createElement('p'); empty.className = 'menu-empty'; empty.textContent = 'Nenhuma aba encontrada.'; fragment.append(empty);
  }
  list.replaceChildren(fragment);
}
$('#open-menu summary').addEventListener('click', () => {
  if (!$('#open-menu').open) { $('#open-tab-search').value = ''; renderOpenDocuments(); }
});
$('#open-menu').addEventListener('toggle', () => {
  if ($('#open-menu').open) renderOpenDocuments();
});
$('#open-tab-search').addEventListener('input', renderOpenDocuments);
$('#document-info').addEventListener('toggle', () => { if ($('#document-info').open) updateDocumentInfo(); });

function toggleSidebar() {
  const hidden = document.body.classList.toggle('sidebar-hidden');
  $('#sidebar-toggle').setAttribute('aria-expanded', String(!hidden));
  if (!hidden) renderOutlineRows();
}

function refreshDocument() {
  clearTimeout(refreshTimer);
  updateOutline(); updateToolbar(); showStatistics();
  if (state.indexedRaw !== state.raw) {
    state.indexedRaw = state.raw;
    state.generation = ++indexGeneration;
    indexWorker.postMessage({ id: state.id, generation: state.generation, text: state.raw });
  }
  if (!$('#find-bar').hidden) updateSearch(false);
}

let outlineHeadings = [];
let outlineKey = null;
function updateOutline() {
  const key = state.source ? state.index : editor.state.doc;
  if (outlineKey === key && outlineHeadings.tabId === state.id) return;
  outlineKey = key;
  const headings = state.source ? [...(state.index?.headings || [])] : [];
  if (!state.source) editor.state.doc.descendants((node, position) => {
    if (node.type.name === 'heading') headings.push({ text: node.textContent || 'Título vazio', level: node.attrs.level, position });
  });
  headings.tabId = state.id; outlineHeadings = headings;
  $('#heading-count').textContent = String(headings.length);
  const nav = $('#outline'); nav.replaceChildren();
  const spacer = document.createElement('div'); spacer.className = 'outline-spacer';
  spacer.style.height = `${headings.length * 32}px`; nav.append(spacer);
  if (!headings.length) { const p = document.createElement('p'); p.className = 'outline-empty'; p.textContent = 'Os títulos aparecem aqui.'; nav.append(p); }
  renderOutlineRows();
}

function renderOutlineRows() {
  const nav = $('#outline'); const spacer = nav.querySelector('.outline-spacer');
  if (!spacer) return;
  const first = Math.max(0, Math.floor(nav.scrollTop / 32) - 6);
  const last = Math.min(outlineHeadings.length, first + Math.ceil((nav.clientHeight || 500) / 32) + 14);
  const fragment = document.createDocumentFragment();
  for (let index = first; index < last; index++) {
    const heading = outlineHeadings[index];
    const button = document.createElement('button'); button.type = 'button';
    button.className = `outline-row level-${Math.min(heading.level, 3)}`;
    button.style.top = `${index * 32}px`; button.textContent = heading.text; button.title = heading.text;
    button.addEventListener('click', () => {
      if (state.source) { source.setSelectionRange(heading.offset); source.focus(); }
      else { editor.chain().focus().setTextSelection(heading.position + 1).run(); editor.view.nodeDOM(heading.position)?.scrollIntoView?.({ block: 'start' }); }
    }); fragment.append(button);
  }
  spacer.replaceChildren(fragment);
}
$('#outline').addEventListener('scroll', renderOutlineRows, { passive: true });
new ResizeObserver(renderOutlineRows).observe($('#outline'));

function updateToolbar() {
  if (!editor || editor.isDestroyed) return;
  document.querySelectorAll('[data-format]').forEach((button) => {
    const format = button.dataset.format;
    button.disabled = state.source;
    if (format === 'undo' || format === 'redo') {
      button.disabled = state.source || !editor.can()[format]();
    } else {
      const active = !state.source && editor.isActive(format);
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  });
  $('#block-type').disabled = state.source;
  $('#block-type').value = editor.isActive('heading') ? String(editor.getAttributes('heading').level) : 'paragraph';
  document.querySelectorAll('[data-table]').forEach((button) => {
    button.disabled = state.source || (button.dataset.table !== 'insertTable' && !editor.isActive('table'));
  });
  $('.table-menu summary').setAttribute('aria-disabled', String(state.source));
}

function applyMode() {
  $('#visual-editor').hidden = state.source;
  source.hidden = !state.source;
  document.body.classList.toggle('source-mode', state.source);
  $('#source-mode').classList.toggle('selected', state.source);
  document.body.classList.toggle('large-document', state.large);
  $('#visual-mode').classList.toggle('selected', !state.source);
  $('#source-mode').setAttribute('aria-pressed', String(state.source));
  $('#visual-mode').setAttribute('aria-pressed', String(!state.source));
  $('#mode-status').textContent = state.source ? 'Fonte Markdown' : 'Edição visual';
  $('#source-note').hidden = !(state.source && (state.special || state.large));
  $('#source-note').textContent = state.large ? 'Documento grande · Texto integral, rolagem contínua e realce de sintaxe desativado. Use </> para alternar para o visual.' : 'Sintaxe especial preservada em Fonte. A edição visual pode simplificá-la.';
  if (state.source) resizeSource();
  updateToolbar();
}

async function setSource(enabled) {
  if (state.source === enabled) return;
  if (!enabled && (state.large || hasSpecialSyntax(state.raw))) {
    const accepted = await ask({
      title: 'Editar visualmente?',
      description: state.large ? 'Este documento é grande. A visualização completa pode levar mais tempo e simplificar extensões de Markdown. O modo Fonte permite editar o arquivo inteiro com menor uso de memória e preservar a sintaxe.' : 'Este arquivo contém sintaxe especial. Esses trechos podem ser simplificados na edição visual. Use Fonte para preservar os detalhes.',
      confirm: 'Abrir no visual', cancel: 'Manter em Fonte',
    });
    if (!accepted) return;
  }
  if (enabled) {
    state.scrollTop = surface.scrollTop;
    state.visualState = editor.state; state.visualRaw = state.raw;
    if (state.codeState && state.codeRaw === state.raw) source.restore(state.codeState);
    else source.load(state.raw, state.large);
  } else {
    state.codeScrollTop = source.scrollTop;
    state.codeState = source.snapshot; state.codeRaw = state.raw;
    if (state.visualState && state.visualRaw === state.raw) editor.view.updateState(state.visualState);
    else makeEditor(state.raw);
  }
  state.source = enabled;
  state.searchIndex = -1;
  applyMode();
  refreshDocument();
  if (enabled) source.focus(); else editor.commands.focus();
  const tabId = state.id;
  requestAnimationFrame(() => {
    if (state.id !== tabId || state.source !== enabled) return;
    if (enabled) source.scrollTop = state.codeScrollTop || 0;
    else surface.scrollTop = state.scrollTop || 0;
  });
}

function resizeSource() { source.requestMeasure(); }
// setSelectionRange already asks the virtual view to reveal the selection.
function scrollSourceTo(_position) {}

source.addEventListener('input', () => {
  state.raw = source.value;
  state.large = isLargeDocument(state.raw);
  state.special = state.large ? state.special : hasSpecialSyntax(state.raw);
  source.setLarge(state.large);
  applyMode();
  updateDirty();
  scheduleRefresh();
});

function toast(message, duration = 3500) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, duration);
}

function ask({ title, description, confirm = 'Continuar', cancel = 'Cancelar', value, validate }) {
  if ($('#app-dialog').open) return Promise.resolve(value === undefined ? false : null);
  $('#dialog-title').textContent = title;
  $('#dialog-description').textContent = description;
  $('#dialog-confirm').textContent = confirm;
  $('#dialog-cancel').textContent = cancel;
  $('#dialog-cancel').hidden = cancel === null;
  $('#dialog-input').hidden = value === undefined;
  $('#dialog-label').hidden = value === undefined;
  $('#dialog-input').value = value || '';
  $('#dialog-error').hidden = true;
  $('#app-dialog').showModal();
  if (value !== undefined) { $('#dialog-input').focus(); $('#dialog-input').select(); }
  return new Promise((resolve) => { dialogResolve = { resolve, input: value !== undefined, validate }; });
}

function finishDialog(accepted) {
  if (!dialogResolve) return;
  const { resolve, input, validate } = dialogResolve;
  const value = $('#dialog-input').value.trim();
  const error = accepted && input && validate ? validate(value) : null;
  if (error) { $('#dialog-error').textContent = error; $('#dialog-error').hidden = false; $('#dialog-input').focus(); return; }
  dialogResolve = null;
  $('#app-dialog').close();
  resolve(input ? accepted ? value : null : accepted);
}

$('#dialog-form').addEventListener('submit', (event) => { event.preventDefault(); finishDialog(true); });
$('#dialog-cancel').addEventListener('click', () => finishDialog(false));
$('#app-dialog').addEventListener('cancel', (event) => { event.preventDefault(); finishDialog(false); });

async function newDocument() {
  loadDocument('');
  editor.commands.focus();
}

async function openDocument() {
  if (desktop?.openFile) {
    const result = await desktop.openFile();
    if (!result || result.canceled) return;
    for (const doc of result.documents || []) {
      loadDocument(doc.content, doc.path);
      // Let the tab strip paint between selected documents.
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    if (result.errors?.length) await ask({ title: 'Alguns arquivos não foram abertos',
      description: result.errors.map(error => `${error.name}: ${error.message}`).join('\n'),
      confirm: 'Continuar', cancel: null });
  } else {
    $('#file-input').value = '';
    $('#file-input').click();
  }
}

$('#file-input').addEventListener('change', async (event) => {
  for (const file of event.target.files) {
    try {
      if (file.size > 64 * 1024 * 1024) throw new Error('O limite é de 64 MiB por documento.');
      const content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      if (content.includes('\0')) throw new Error('Este arquivo não parece ser texto UTF-8.');
      loadDocument(content, null, file.name);
      await new Promise(resolve => requestAnimationFrame(resolve));
    } catch (error) { await ask({ title: 'Não foi possível abrir', description: `${file.name}: ${error.message}`, confirm: 'Continuar', cancel: null }); }
  }
});

function download(content, name, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function saveDocument(saveAs = false) {
  const snapshot = state.raw;
  const targetTab = state;
  if (desktop?.saveFile) {
    const result = await desktop.saveFile({ path: state.path, content: snapshot, saveAs });
    if (!result || result.canceled) return;
    if (!tabs.includes(targetTab)) return;
    targetTab.path = result.path;
    targetTab.name = basename(result.path);
  } else {
    download(snapshot, state.name.endsWith('.md') ? state.name : `${stem(state.name)}.md`, 'text/markdown;charset=utf-8');
  }
  targetTab.saved = snapshot;
  targetTab.dirty = targetTab.raw !== targetTab.saved;
  updateDirty();
  toast(desktop ? 'Documento salvo.' : 'Arquivo Markdown preparado para download.');
}

const EXPORT_CSS = `body{max-width:780px;margin:50px auto;padding:0 35px;color:#27342b;background:#fff;font:17px/1.8 Georgia,serif;overflow-wrap:anywhere}h1,h2,h3,h4,h5,h6{font-weight:500;line-height:1.3}h1{font-size:36px}h2{font-size:27px;margin-top:1.5em}h3{font-size:22px}a{color:#45644e}blockquote{border-left:2px solid #78946b;color:#64715f;margin:1.5em 0;padding-left:22px}code{background:#f0f2eb;padding:2px 5px;border-radius:3px;font:13px Consolas,monospace}pre{padding:20px;background:#f0f2eb;white-space:pre-wrap;border-radius:6px}pre code{padding:0}table{border-collapse:collapse;width:100%;font:13px/1.6 'Segoe UI',sans-serif}th,td{border:1px solid #d6ded0;padding:9px 12px;text-align:left}th{background:#f0f2eb}img{max-width:100%;height:auto}ul[data-type=taskList]{list-style:none;padding-left:0}ul[data-type=taskList] li{display:flex;align-items:baseline;gap:10px}ul[data-type=taskList] li>div{flex:1}ul[data-type=taskList] li p{margin:.1em 0}hr{border:0;border-top:1px solid #d6ded0;margin:2em 0}@page{size:A4;margin:18mm}@media print{body{margin:0;padding:0;max-width:none}h1,h2,h3{break-after:avoid}pre,blockquote,tr,img{break-inside:avoid}a{color:inherit;text-decoration:underline}}`;

function exportMarkup() {
  const content = state.source ? generateHTML(editor.markdown.parse(state.raw), editor.options.extensions) : editor.getHTML();
  // Only schema-generated HTML is included. Raw source is never interpolated.
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: https: http:;"><title>${escaped(stem(state.name))}</title><style>${EXPORT_CSS}</style></head><body>${content}</body></html>`;
}

async function exportDocument(format) {
  if (state.special && !await ask({ title: 'Exportar a visualização?', description: 'A exportação usa os recursos de formatação desta versão. Sintaxe especial pode aparecer simplificada ou ser omitida. O arquivo Markdown original continua disponível em Salvar.', confirm: 'Exportar' })) return;
  const html = exportMarkup();
  const suggestedName = `${stem(state.name)}.${format === 'html' ? 'html' : 'pdf'}`;
  if (format === 'html') {
    if (desktop?.exportHtml) {
      const result = await desktop.exportHtml({ html, suggestedName });
      if (!result || result.canceled) return;
    } else download(html, suggestedName, 'text/html;charset=utf-8');
  } else if (desktop?.exportPdf) {
    const result = await desktop.exportPdf({ html, suggestedName });
    if (!result || result.canceled) return;
  } else {
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const printWindow = window.open(url, '_blank');
    if (!printWindow) { URL.revokeObjectURL(url); throw new Error('Permita a janela de impressão no navegador para exportar PDF.'); }
    printWindow.addEventListener('load', () => { printWindow.focus(); printWindow.print(); }, { once: true });
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast('Escolha “Salvar como PDF” na janela de impressão.');
    return;
  }
  toast(`${format.toUpperCase()} ${desktop ? 'exportado' : 'preparado para download'}.`);
}

async function insertLink() {
  if (state.source) return;
  const previous = editor.getAttributes('link').href || '';
  const value = await ask({
    title: previous ? 'Editar link' : 'Inserir link',
    description: 'Selecione um trecho do texto e informe o endereço. Deixe vazio para remover o link.',
    confirm: 'Aplicar', value: previous,
    validate: (url) => !url || /^(https?:\/\/|mailto:|tel:|#)/i.test(url) ? null : 'Use um endereço com https://, http://, mailto:, tel: ou #.',
  });
  if (value === null) return;
  const chain = editor.chain().focus().extendMarkRange('link');
  if (value === '') chain.unsetLink().run();
  else if (editor.state.selection.empty && !previous) chain.insertContent({ type: 'text', text: value, marks: [{ type: 'link', attrs: { href: value } }] }).run();
  else chain.setLink({ href: value }).run();
}

const formatCommands = {
  bold: 'toggleBold', italic: 'toggleItalic', strike: 'toggleStrike', code: 'toggleCode',
  bulletList: 'toggleBulletList', orderedList: 'toggleOrderedList', taskList: 'toggleTaskList',
  blockquote: 'toggleBlockquote', codeBlock: 'toggleCodeBlock', undo: 'undo', redo: 'redo',
};

document.querySelectorAll('[data-format]').forEach((button) => {
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', () => {
    if (state.source) return;
    const format = button.dataset.format;
    if (format === 'link') { insertLink().catch(reportError); return; }
    editor.chain().focus()[formatCommands[format]]().run();
    updateToolbar();
  });
});

$('#block-type').addEventListener('change', (event) => {
  if (state.source) return;
  const value = event.target.value;
  if (value === 'paragraph') editor.chain().focus().setParagraph().run();
  else editor.chain().focus().toggleHeading({ level: Number(value) }).run();
});

document.querySelectorAll('[data-table]').forEach((button) => {
  button.addEventListener('click', () => {
    if (state.source) return;
    const command = button.dataset.table;
    const chain = editor.chain().focus();
    if (command === 'insertTable') chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    else chain[command]().run();
    button.closest('details').open = false;
  });
});

function visualMatches(query) {
  const matches = [];
  const needle = query.toLocaleLowerCase('pt-BR');
  editor.state.doc.descendants((node, blockPosition) => {
    if (!node.isTextblock) return;
    let text = '';
    const positions = [];
    node.descendants((child, offset) => {
      if (child.isText) {
        for (let index = 0; index < child.text.length; index++) {
          text += child.text[index];
          positions.push(blockPosition + 1 + offset + index);
        }
      } else if (child.isLeaf) {
        text += '\n';
        positions.push(blockPosition + 1 + offset);
      }
    });
    const haystack = text.toLocaleLowerCase('pt-BR');
    let offset = 0;
    let index;
    while ((index = haystack.indexOf(needle, offset)) !== -1) {
      matches.push({ from: positions[index], to: positions[index + needle.length - 1] + 1 });
      offset = index + Math.max(needle.length, 1);
    }
    return false;
  });
  return matches;
}

function sourceMatches(query) {
  const result = [];
  const haystack = source.value.toLocaleLowerCase('pt-BR');
  const needle = query.toLocaleLowerCase('pt-BR');
  let offset = 0;
  let index;
  while ((index = haystack.indexOf(needle, offset)) !== -1) {
    result.push({ from: index, to: index + needle.length });
    offset = index + Math.max(needle.length, 1);
  }
  return result;
}

function updateSearch(navigate = false) {
  const query = $('#find-input').value;
  state.searchMatches = query ? state.source ? sourceMatches(query) : visualMatches(query) : [];
  state.searchIndex = state.searchMatches.length ? Math.min(Math.max(state.searchIndex, 0), state.searchMatches.length - 1) : -1;
  $('#find-count').textContent = state.searchMatches.length ? `${state.searchIndex + 1} de ${state.searchMatches.length}` : query ? 'Nenhum resultado' : '0 resultados';
  if (!state.source) editor.view.dispatch(editor.state.tr.setMeta(searchKey, state.searchMatches));
  else source.search(query);
  if (navigate) navigateSearch(0);
}

function navigateSearch(direction) {
  const length = state.searchMatches.length;
  if (!length) return;
  state.searchIndex = (state.searchIndex + direction + length) % length;
  const match = state.searchMatches[state.searchIndex];
  $('#find-count').textContent = `${state.searchIndex + 1} de ${length}`;
  if (state.source) {
    source.setSelectionRange(match.from, match.to);
    scrollSourceTo(match.from);
  } else {
    editor.commands.setTextSelection(match);
    editor.view.dispatch(editor.state.tr.setMeta(searchKey, state.searchMatches).scrollIntoView());
  }
}

function showFind() {
  $('#find-bar').hidden = false;
  $('#find-input').focus();
  $('#find-input').select();
  updateSearch(false);
}

function hideFind() {
  $('#find-bar').hidden = true;
  state.searchMatches = [];
  state.searchIndex = -1;
  editor.view.dispatch(editor.state.tr.setMeta(searchKey, []));
  source.search('');
  if (state.source) source.focus(); else editor.commands.focus();
}

$('#find-input').addEventListener('input', () => { state.searchIndex = 0; updateSearch(true); });
$('#find-input').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); navigateSearch(-1); }
});
$('#find-bar').addEventListener('submit', (event) => { event.preventDefault(); navigateSearch(1); });

function toggleFocus(force) {
  state.focus = force === undefined ? !state.focus : force;
  document.body.classList.toggle('focus-mode', state.focus);
  $('#focus-button').setAttribute('aria-pressed', String(state.focus));
  if (state.source) source.focus(); else editor.commands.focus();
}

function toggleTheme() {
  const dark = document.body.dataset.theme !== 'dark';
  document.body.dataset.theme = dark ? 'dark' : 'light';
  $('#theme-button').setAttribute('aria-label', `Alternar para tema ${dark ? 'claro' : 'escuro'}`);
  $('#theme-label').textContent = `Usar tema ${dark ? 'claro' : 'escuro'}`;
  writeSetting('collie-theme', dark ? 'dark' : 'light');
}

function reportError(error) { console.error(error); toast(error?.message || 'Não foi possível concluir esta ação.', 6000); }

async function handleCommand(command) {
  if (typeof command === 'object') command = command?.command;
  document.querySelectorAll('details[open]').forEach((details) => { details.open = false; });
  if (operationBusy && ['new', 'open', 'save', 'save-as', 'export-html', 'export-pdf'].includes(command)) return;
  const fileOperation = ['new', 'open', 'save', 'save-as', 'export-html', 'export-pdf'].includes(command);
  if (fileOperation) {
    operationBusy = true;
    $('#operation-status').hidden = false;
    $('#operation-status').textContent = command === 'open' ? 'Abrindo documentos…' : 'Preparando documento…';
    document.querySelectorAll('[data-action="open"], [data-action="new"]').forEach(button => { button.disabled = true; });
  }
  try {
    switch (command) {
      case 'close-tab': await closeTab(); break;
      case 'next-tab': activateTab(tabs[(tabs.indexOf(state) + 1) % tabs.length].id); break;
      case 'previous-tab': activateTab(tabs[(tabs.indexOf(state) + tabs.length - 1) % tabs.length].id); break;
      case 'new': await newDocument(); break;
      case 'open': await openDocument(); break;
      case 'save': await saveDocument(); break;
      case 'save-as': await saveDocument(true); break;
      case 'export-html': await exportDocument('html'); break;
      case 'export-pdf': await exportDocument('pdf'); break;
      case 'source': await setSource(!state.source); break;
      case 'source-mode': await setSource(true); break;
      case 'visual': await setSource(false); break;
      case 'focus': toggleFocus(); break;
      case 'theme': toggleTheme(); break;
      case 'find': showFind(); break;
      case 'find-next': navigateSearch(1); break;
      case 'find-prev': navigateSearch(-1); break;
      case 'find-close': hideFind(); break;
      case 'sidebar': toggleSidebar(); break;
      case 'close-window': await desktop?.closeWindow?.(); break;
      case 'help': await ask({ title: 'Seu texto, com liberdade', description: 'Ctrl+N  Novo documento\nCtrl+O  Abrir Markdown\nCtrl+S  Salvar\nCtrl+Shift+S  Salvar como\nCtrl+B / Ctrl+I  Negrito / Itálico\nCtrl+K  Inserir link\nCtrl+F  Buscar no documento\nF8  Modo foco\nCtrl+/  Visual / Fonte\nCtrl+Shift+T  Alternar tema\nEsc  Fechar busca ou sair do foco\n\nO modo visual suporta Markdown comum, tabelas simples e tarefas. Ao editar visualmente, a sintaxe pode ser normalizada. Para preservar extensões especiais ou a formatação exata, edite em Fonte. Imagens remotas não são carregadas nesta versão. Não há sincronização, fórmulas ou corretor de código.', confirm: 'Voltar à escrita', cancel: null }); break;
    }
  } catch (error) { reportError(error); }
  finally { if (fileOperation) {
    operationBusy = false;
    $('#operation-status').hidden = true;
    document.querySelectorAll('[data-action="open"], [data-action="new"]').forEach(button => { button.disabled = false; });
  } }
}

document.querySelectorAll('[data-action]').forEach((button) => {
  button.addEventListener('click', () => handleCommand(button.dataset.action));
});

document.addEventListener('click', (event) => {
  document.querySelectorAll('details[open]').forEach((details) => { if (!details.contains(event.target)) details.open = false; });
});

document.addEventListener('keydown', (event) => {
  if ($('#app-dialog').open) return;
  if (event.key === 'F8' && !desktop) { event.preventDefault(); toggleFocus(); return; }
  if (event.key === 'Escape') {
    const expanded = [...document.querySelectorAll('details[open]')];
    expanded.forEach(details => { details.open = false; });
    if (expanded.length) { event.preventDefault(); expanded[0].querySelector('summary').focus(); return; }
    if (!$('#find-bar').hidden) { event.preventDefault(); hideFind(); }
    else if (state.focus) { event.preventDefault(); toggleFocus(false); }
    return;
  }
  if (event.altKey && /^[1-9]$/.test(event.key)) {
    const tab = tabs[Number(event.key) - 1];
    if (tab) { event.preventDefault(); activateTab(tab.id); }
    return;
  }
  const modifier = event.ctrlKey || event.metaKey;
  if (!modifier || event.altKey) return;
  const key = event.key.toLowerCase();
  // Electron's application menu already owns these accelerators; handling them
  // here as well would invoke dialogs twice. Browser fallback owns all shortcuts.
  const shellKeys = desktop && ['n', 'o', 's', 'f'].includes(key);
  if (shellKeys) return;
  let action;
  if (key === 't' && !event.shiftKey) action = 'new';
  else if (key === 'w' && !desktop) action = 'close-tab';
  else if (key === 'tab' && !desktop) action = event.shiftKey ? 'previous-tab' : 'next-tab';
  else if (key === 'n') action = 'new';
  else if (key === 'o') action = 'open';
  else if (key === 's') action = event.shiftKey ? 'save-as' : 'save';
  else if (key === 'f') action = event.shiftKey ? 'focus' : 'find';
  else if ((key === '/' || event.code === 'Slash') && !desktop) action = 'source';
  else if (key === 't' && event.shiftKey && !desktop) action = 'theme';
  else if (key === 'k' && !state.source) { event.preventDefault(); insertLink().catch(reportError); return; }
  if (action) { event.preventDefault(); handleCommand(action); }
});

if (!desktop) window.addEventListener('beforeunload', (event) => {
  if (tabs.some(tab => tab.raw !== tab.saved)) { event.preventDefault(); event.returnValue = ''; }
});

if (desktop?.onCommand) desktop.onCommand((command) => handleCommand(command));
const savedTheme = readSetting('collie-theme');
document.body.dataset.theme = savedTheme === 'dark' ? 'dark' : 'light';
$('#theme-button').setAttribute('aria-label', `Alternar para tema ${savedTheme === 'dark' ? 'claro' : 'escuro'}`);
$('#theme-label').textContent = `Usar tema ${savedTheme === 'dark' ? 'claro' : 'escuro'}`;
$('#close-window').hidden = !desktop?.closeWindow;
window.addEventListener('resize', () => { if (state.source) resizeSource(); });
loadDocument(WELCOME, null, 'Boas-vindas.md');
