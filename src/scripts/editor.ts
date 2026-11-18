// A small CodeMirror 6 editor for Tiny, with end-of-line annotations and line highlights.

import { minimalSetup } from 'codemirror';
import { EditorView, Decoration, WidgetType, lineNumbers, keymap, type DecorationSet } from '@codemirror/view';
import { EditorState, StateEffect, StateField, RangeSetBuilder } from '@codemirror/state';
import { StreamLanguage, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { indentWithTab } from '@codemirror/commands';
import { tags as t } from '@lezer/highlight';

const tiny = StreamLanguage.define<null>({
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match('//')) { stream.skipToEnd(); return 'comment'; }
    if (stream.match(/^(if|else|while|assert|input|true|false)\b/)) return 'keyword';
    if (stream.match(/^[0-9]+/)) return 'number';
    if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*/)) return 'variableName';
    if (stream.match(/^(<=|>=|==|!=|&&|\|\||[-+*/<>=!])/)) return 'operator';
    stream.next();
    return null;
  },
});

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--insight)', fontWeight: '600' },
  { tag: t.number, color: 'var(--warn)' },
  { tag: t.comment, color: 'var(--muted)', fontStyle: 'italic' },
  { tag: t.operator, color: 'var(--muted)' },
  { tag: t.variableName, color: 'var(--text)' },
]);

export interface Annotation { text: string; cls?: string; title?: string }

class AnnotationWidget extends WidgetType {
  constructor(readonly a: Annotation) { super(); }
  eq(o: AnnotationWidget) { return o.a.text === this.a.text && o.a.cls === this.a.cls; }
  toDOM() {
    const span = document.createElement('span');
    span.className = `cm-annot ${this.a.cls ?? ''}`;
    span.textContent = this.a.text;
    if (this.a.title) span.title = this.a.title;
    return span;
  }
  ignoreEvent() { return true; }
}

interface Decor { annotations: Map<number, Annotation>; lineClasses: Map<number, string> }
const setDecor = StateEffect.define<Decor>();

const decorField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setDecor)) continue;
      const doc = tr.state.doc;
      const b = new RangeSetBuilder<Decoration>();
      for (let ln = 1; ln <= doc.lines; ln++) {
        const line = doc.line(ln);
        const cls = e.value.lineClasses.get(ln);
        if (cls) b.add(line.from, line.from, Decoration.line({ class: cls }));
        const a = e.value.annotations.get(ln);
        if (a) b.add(line.to, line.to, Decoration.widget({ widget: new AnnotationWidget(a), side: 1 }));
      }
      deco = b.finish();
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const theme = EditorView.theme({
  '&': { fontSize: '14.5px', background: 'var(--surface)', color: 'var(--text)' },
  '.cm-content': { fontFamily: 'var(--mono)', padding: '10px 0', caretColor: 'var(--text)', fontVariantLigatures: 'none' },
  '.cm-scroller': { fontFamily: 'var(--mono)' },
  '.cm-gutters': { background: 'var(--bg-soft)', color: 'var(--muted)', border: 'none', borderRight: '1px solid var(--border)' },
  '.cm-activeLine': { background: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--text)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { background: 'var(--accent-soft) !important' },
});

export function createEditor(parent: HTMLElement, doc: string, onChange: (doc: string) => void) {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        minimalSetup,
        lineNumbers(),
        keymap.of([indentWithTab]),
        tiny,
        syntaxHighlighting(highlight),
        decorField,
        theme,
        EditorView.updateListener.of((u) => { if (u.docChanged) onChange(u.state.doc.toString()); }),
      ],
    }),
  });
  return {
    view,
    getDoc: () => view.state.doc.toString(),
    setDoc: (text: string) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }),
    decorate: (annotations: Map<number, Annotation>, lineClasses: Map<number, string> = new Map()) =>
      view.dispatch({ effects: setDecor.of({ annotations, lineClasses }) }),
  };
}
