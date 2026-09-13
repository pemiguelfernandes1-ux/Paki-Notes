import { marked } from "marked";

marked.setOptions({
  breaks: true, // uma quebra de linha simples já vira <br>, como no Bundled
});

/**
 * Renderiza Markdown para HTML. Como o Paki Notes é de uso pessoal
 * (conteúdo escrito só por você, sem notas vindas de terceiros),
 * não sanitizamos o HTML resultante — se algum dia o app aceitar
 * conteúdo de outra fonte (import, sync com outro dispositivo),
 * isso precisa ser revisado.
 */
export function renderMarkdown(source: string): string {
  if (!source.trim()) return "";
  return marked.parse(source, { async: false }) as string;
}
