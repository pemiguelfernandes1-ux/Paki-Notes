import { EditorState, RangeSetBuilder } from "@codemirror/state";
import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate, keymap, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";

/**
 * Editor "ao vivo": um único bloco de texto onde negrito, itálico, riscado,
 * código inline, títulos, citação e checklist já aparecem formatados
 * enquanto você digita — sem uma caixa de preview separada.
 *
 * Simplificação assumida: os marcadores de Markdown (**, _, #, etc.)
 * continuam visíveis (só ficam com uma cor mais apagada), em vez de somem
 * quando o cursor não está em cima deles como no Obsidian. Dá pra evoluir
 * pra isso depois, mas exige lógica bem mais complexa de decoração
 * dependente da posição do cursor.
 */

interface InlineMatch {
  from: number;
  to: number;
  markerLen: number;
  contentClass: string;
}

// Ordem importa: o primeiro da lista "ganha" em caso de sobreposição
// (ex.: código inline não deveria virar negrito por acidente).
const INLINE_PATTERNS: { regex: RegExp; markerLen: number; contentClass: string }[] = [
  { regex: /`([^`\n]+)`/g, markerLen: 1, contentClass: "cm-md-code" },
  { regex: /\*\*([^*\n]+)\*\*/g, markerLen: 2, contentClass: "cm-md-bold" },
  { regex: /~~([^~\n]+)~~/g, markerLen: 2, contentClass: "cm-md-strike" },
  { regex: /(?<!\*)\*([^*\n]+)\*(?!\*)/g, markerLen: 1, contentClass: "cm-md-italic" },
  { regex: /(?<!_)_([^_\n]+)_(?!_)/g, markerLen: 1, contentClass: "cm-md-italic" },
];

function collectLineMatches(lineFrom: number, text: string): InlineMatch[] {
  const candidates: InlineMatch[] = [];
  for (const { regex, markerLen, contentClass } of INLINE_PATTERNS) {
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text))) {
      candidates.push({
        from: lineFrom + m.index,
        to: lineFrom + m.index + m[0].length,
        markerLen,
        contentClass,
      });
      if (m[0].length === 0) regex.lastIndex++; // segurança contra loop infinito
    }
  }
  candidates.sort((a, b) => a.from - b.from);

  const accepted: InlineMatch[] = [];
  let lastTo = -1;
  for (const c of candidates) {
    if (c.from >= lastTo) {
      accepted.push(c);
      lastTo = c.to;
    }
  }
  return accepted;
}

function buildInlineDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;

  for (let lineNo = 1; lineNo <= doc.lines; lineNo++) {
    const line = doc.line(lineNo);
    const matches = collectLineMatches(line.from, line.text);

    for (const m of matches) {
      const { from, to, markerLen, contentClass } = m;
      builder.add(from, from + markerLen, Decoration.mark({ class: "cm-md-marker" }));
      builder.add(from + markerLen, to - markerLen, Decoration.mark({ class: contentClass }));
      builder.add(to - markerLen, to, Decoration.mark({ class: "cm-md-marker" }));
    }
  }

  return builder.finish();
}

function buildLineDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;

  for (let lineNo = 1; lineNo <= doc.lines; lineNo++) {
    const line = doc.line(lineNo);
    const text = line.text;

    const heading = /^(#{1,3})\s/.exec(text);
    const checklist = /^[-*]\s\[( |x|X)\]\s/.exec(text);
    const bullet = !checklist && /^[-*]\s/.exec(text);
    const quote = /^>\s?/.exec(text);

    if (heading) {
      builder.add(line.from, line.from, Decoration.line({ class: `cm-md-h${heading[1].length}` }));
    } else if (checklist) {
      const done = checklist[1].toLowerCase() === "x";
      builder.add(
        line.from,
        line.from,
        Decoration.line({ class: done ? "cm-md-checklist cm-md-checklist--done" : "cm-md-checklist" }),
      );
    } else if (bullet) {
      builder.add(line.from, line.from, Decoration.line({ class: "cm-md-bullet" }));
    } else if (quote) {
      builder.add(line.from, line.from, Decoration.line({ class: "cm-md-quote" }));
    }
  }

  return builder.finish();
}

const inlinePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildInlineDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildInlineDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

const linePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildLineDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildLineDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

const editorTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      fontSize: "14px",
      backgroundColor: "transparent",
      color: "var(--text)",
    },
    ".cm-content": {
      fontFamily: "var(--font-body)",
      padding: "0",
      caretColor: "var(--accent)",
    },
    ".cm-scroller": {
      fontFamily: "var(--font-body)",
      lineHeight: "1.6",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-line": { padding: "1px 0" },
    ".cm-placeholder": { color: "var(--text-dim)" },
  },
  { dark: true },
);

export interface LiveMarkdownEditorOptions {
  parent: HTMLElement;
  doc: string;
  onChange: (content: string) => void;
}

export class LiveMarkdownEditor {
  private view: EditorView;
  private onChange: (content: string) => void;

  constructor(opts: LiveMarkdownEditorOptions) {
    this.onChange = opts.onChange;
    this.view = new EditorView({
      state: this.buildState(opts.doc),
      parent: opts.parent,
    });
  }

  private buildState(doc: string): EditorState {
    return EditorState.create({
      doc,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown(),
        EditorView.lineWrapping,
        placeholder("Escreva em Markdown..."),
        linePlugin,
        inlinePlugin,
        editorTheme,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) this.onChange(update.state.doc.toString());
        }),
      ],
    });
  }

  /** Troca o conteúdo (ex.: ao abrir outra nota) sem recriar o editor. */
  setContent(doc: string) {
    if (this.view.state.doc.toString() === doc) return;
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: doc },
    });
  }

  getContent(): string {
    return this.view.state.doc.toString();
  }

  /**
   * Usado pelos botões da toolbar (negrito, itálico, título, checklist).
   * Marcadores que terminam em espaço (ex.: "# ", "- [ ] ") são tratados
   * como prefixo de linha — inseridos no início da linha atual, não na
   * posição exata do cursor, pra sempre gerar Markdown válido.
   */
  wrapSelection(marker: string) {
    const { state } = this.view;
    const range = state.selection.main;
    const isLinePrefix = marker.endsWith(" ");

    if (isLinePrefix) {
      const line = state.doc.lineAt(range.from);
      this.view.dispatch({
        changes: { from: line.from, insert: marker },
        selection: { anchor: range.from + marker.length, head: range.to + marker.length },
      });
    } else {
      this.view.dispatch({
        changes: [
          { from: range.from, insert: marker },
          { from: range.to, insert: marker },
        ],
        selection: { anchor: range.from + marker.length, head: range.to + marker.length },
      });
    }
    this.view.focus();
  }

  focus() {
    this.view.focus();
  }

  destroy() {
    this.view.destroy();
  }
}
