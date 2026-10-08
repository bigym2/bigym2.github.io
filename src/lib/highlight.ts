// Build-time syntax highlighting for the policy explorer. Both colour themes
// are emitted as CSS variables; global.css picks one per data-theme.
import { createHighlighter, type Highlighter } from 'shiki';

let highlighter: Promise<Highlighter> | undefined;

export async function highlightPython(code: string): Promise<string> {
  highlighter ??= createHighlighter({ themes: ['vitesse-light', 'vitesse-dark'], langs: ['python'] });
  const h = await highlighter;
  return h.codeToHtml(code.replace(/\n$/, ''), {
    lang: 'python',
    themes: { light: 'vitesse-light', dark: 'vitesse-dark' },
    defaultColor: false,
  });
}
