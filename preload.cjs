'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const COMMANDS = new Set(['close-tab','next-tab','previous-tab','new','open','save','save-as','export-html','export-pdf','source','focus','theme','find']);

contextBridge.exposeInMainWorld('desktop', Object.freeze({
  closeWindow: () => ipcRenderer.invoke('collie:close-window'),
  openFile: () => ipcRenderer.invoke('collie:open'),
  saveFile: payload => ipcRenderer.invoke('collie:save', {
    path: payload?.path, content: payload?.content, saveAs: payload?.saveAs === true
  }),
  exportHtml: payload => ipcRenderer.invoke('collie:export-html', {
    html: payload?.html, suggestedName: payload?.suggestedName
  }),
  exportPdf: payload => ipcRenderer.invoke('collie:export-pdf', {
    html: payload?.html, suggestedName: payload?.suggestedName
  }),
  setTitle: payload => ipcRenderer.send('collie:title', { name: payload?.name, dirty: payload?.dirty === true, unsavedCount: payload?.unsavedCount }),
  onCommand: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, command) => { if (COMMANDS.has(command)) callback(command); };
    ipcRenderer.on('collie:command', listener);
    return () => ipcRenderer.removeListener('collie:command', listener);
  }
}));
