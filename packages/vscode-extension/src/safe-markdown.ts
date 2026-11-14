import { Lexer, type MarkedToken } from 'marked';
import { escapeHtml } from './home-view.js';

/** Parse tokens, never trust parser-generated HTML, link destinations or attributes. */
export function safeMarkdown(text: string): string {
  if (text.length > 16000) throw new Error('WIKI_RENDER_LIMIT');
  let count = 0;
  const render = (tokens: MarkedToken[], depth = 0): string => {
    if (depth > 32) throw new Error('WIKI_RENDER_LIMIT');
    const nested = (tokens: unknown) =>
      render(tokens as MarkedToken[], depth + 1);
    return tokens
      .map((token) => {
        if (++count > 5000) throw new Error('WIKI_RENDER_LIMIT');
        switch (token.type) {
          case 'space':
          case 'def':
            return '';
          case 'heading':
            return `<h${Math.min(6, Math.max(1, token.depth))}>${nested(token.tokens)}</h${Math.min(6, Math.max(1, token.depth))}>`;
          case 'paragraph':
            return `<p>${nested(token.tokens)}</p>`;
          case 'text':
            return token.tokens ? nested(token.tokens) : escapeHtml(token.text);
          case 'escape':
          case 'html':
            return escapeHtml(token.text);
          case 'code':
            return `<pre><code>${escapeHtml(token.text)}</code></pre>`;
          case 'codespan':
            return `<code>${escapeHtml(token.text)}</code>`;
          case 'strong':
            return `<strong>${nested(token.tokens)}</strong>`;
          case 'em':
            return `<em>${nested(token.tokens)}</em>`;
          case 'del':
            return `<del>${nested(token.tokens)}</del>`;
          case 'blockquote':
            return `<blockquote>${nested(token.tokens)}</blockquote>`;
          case 'list':
            return `<${token.ordered ? 'ol' : 'ul'}>${token.items.map((item) => `<li>${nested(item.tokens)}</li>`).join('')}</${token.ordered ? 'ol' : 'ul'}>`;
          case 'list_item':
            return `<li>${nested(token.tokens)}</li>`;
          case 'link':
            return `<span class="disabled-link">${nested(token.tokens)}</span>`;
          case 'image':
            return `<span>[图片：${escapeHtml(token.text)}]</span>`;
          case 'table':
            return `<table><thead><tr>${token.header.map((cell) => `<th>${nested(cell.tokens)}</th>`).join('')}</tr></thead><tbody>${token.rows.map((row) => `<tr>${row.map((cell) => `<td>${nested(cell.tokens)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
          case 'br':
            return '<br>';
          case 'hr':
            return '<hr>';
          case 'checkbox':
            return token.checked ? '☑' : '☐';
          default:
            throw new Error('WIKI_MARKDOWN_UNSUPPORTED');
        }
      })
      .join('');
  };
  // An isolated lexer: another consumer's global extensions cannot add HTML renderers.
  const html = render(new Lexer({ gfm: true }).lex(text) as MarkedToken[]);
  if (Buffer.byteLength(html, 'utf8') > 256 * 1024)
    throw new Error('WIKI_RENDER_LIMIT');
  return html;
}
