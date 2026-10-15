import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { SearchQuery, setSearchQuery, findNext, findPrevious } from '@codemirror/search';

export function createSourceEditor(element) {
  let inputListener = () => {};
  let replacing = false;
  const extensions = [
    basicSetup, markdown(), EditorView.lineWrapping,
    EditorView.contentAttributes.of({ 'aria-label': 'Código Markdown', spellcheck: 'false' }),
    EditorView.updateListener.of(update => {
      if (update.docChanged && !replacing) inputListener();
    }),
  ];
  const view = new EditorView({ parent: element, state: EditorState.create({ doc: '', extensions }) });
  return {
    get value() { return view.state.doc.toString(); },
    set value(value) {
      replacing = true;
      view.setState(EditorState.create({ doc: value, extensions }));
      replacing = false;
    },
    get hidden() { return element.hidden; },
    set hidden(hidden) { element.hidden = hidden; if (!hidden) view.requestMeasure(); },
    get scrollTop() { return view.scrollDOM.scrollTop; },
    set scrollTop(value) { view.scrollDOM.scrollTop = value; },
    get snapshot() { return view.state; },
    restore(snapshot) { replacing = true; view.setState(snapshot); replacing = false; },
    focus() { view.focus(); },
    addEventListener(name, listener) { if (name === 'input') inputListener = listener; },
    setSelectionRange(from, to = from) {
      const max = view.state.doc.length;
      view.dispatch({ selection: { anchor: Math.min(from, max), head: Math.min(to, max) },
        effects: EditorView.scrollIntoView(Math.min(from, max), { y: 'center' }) });
    },
    search(query) { view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: query, caseSensitive: false })) }); },
    find(direction) { (direction < 0 ? findPrevious : findNext)(view); },
    requestMeasure() { view.requestMeasure(); },
  };
}
