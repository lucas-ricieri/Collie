import { EditorView, minimalSetup } from 'codemirror';
import { lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { bracketMatching, indentOnInput, foldGutter } from '@codemirror/language';
import { EditorState, Compartment } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { SearchQuery, setSearchQuery, findNext, findPrevious, highlightSelectionMatches } from '@codemirror/search';

export function createSourceEditor(element) {
  let inputListener = () => {};
  let replacing = false;
  const features = new Compartment();
  const normalFeatures = [markdown(), EditorView.lineWrapping, bracketMatching(), indentOnInput(), foldGutter(), highlightSelectionMatches()];
  const largeFeatures = [];
  const extensions = [
    minimalSetup, lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(),
    EditorView.contentAttributes.of({ 'aria-label': 'Código Markdown', spellcheck: 'false' }),
    EditorView.updateListener.of(update => {
      if (update.docChanged && !replacing) inputListener();
    }),
  ];
  const view = new EditorView({ parent: element, state: EditorState.create({ doc: '', extensions: [...extensions, features.of(normalFeatures)] }) });
  return {
    get value() { return view.state.doc.toString(); },
    load(value, large = false) {
      replacing = true;
      view.setState(EditorState.create({ doc: value, extensions: [...extensions, features.of(large ? largeFeatures : normalFeatures)] }));
      element.dataset.large = String(large);
      replacing = false;
    },
    setLarge(large) {
      const target = large ? largeFeatures : normalFeatures;
      if (features.get(view.state) === target) return;
      // Document updates notify listeners while EditorView is updating.
      // Reconfigure afterwards, only if this document state is still active.
      const snapshot = view.state;
      queueMicrotask(() => {
        if (view.state !== snapshot) return;
        view.dispatch({ effects: features.reconfigure(target) });
        element.dataset.large = String(large);
      });
    },
    get hidden() { return element.hidden; },
    set hidden(hidden) { element.hidden = hidden; if (!hidden) view.requestMeasure(); },
    get scrollTop() { return view.scrollDOM.scrollTop; },
    set scrollTop(value) { view.scrollDOM.scrollTop = value; },
    get snapshot() { return view.state; },
    restore(snapshot) { replacing = true; view.setState(snapshot); element.dataset.large = String(features.get(snapshot) === largeFeatures); replacing = false; },
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
