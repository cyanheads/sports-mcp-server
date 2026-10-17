/**
 * @fileoverview Render inline data literally without changing authored Markdown or structured values.
 * @module mcp-server/tools/formatting
 */

/** Flatten line breaks and escape HTML/inline Markdown in interpolated data exactly once. */
export function inline(parts: TemplateStringsArray, ...values: Array<string | number>): string {
  let text = parts[0] ?? '';
  for (let index = 0; index < values.length; index++) {
    const value = String(values[index]);
    // Entity text cannot open a Markdown block, even for indentation or ordered markers.
    const escapeLeading =
      (/^ {0,3}$/.test(text.slice(text.lastIndexOf('\n') + 1)) &&
        /^(?:[\t\r\n #+=-]|\d{1,9}[.)])/.test(value)) ||
      (/[*_`]$/.test(parts[index] ?? '') && /^\s/.test(value));
    const closingDelimiter = /^[*_`]/.test(parts[index + 1] ?? '');
    for (let i = 0; i < value.length; i++) {
      const char = value.charAt(i);
      const last =
        i === value.length - 1 ||
        (char === '\r' && i === value.length - 2 && value[i + 1] === '\n');
      if ((i === 0 && escapeLeading) || (last && closingDelimiter && /\s/.test(char))) {
        text += `&#${char === '\r' || char === '\n' ? 32 : char.charCodeAt(0)};`;
        if (char === '\r' && value[i + 1] === '\n') i++;
      } else if (char === '\r' || char === '\n') {
        text += ' ';
        if (char === '\r' && value[i + 1] === '\n') i++;
      } else if (char === '&') text += '&amp;';
      else if (char === '<') text += '&lt;';
      else if (char === '>') text += '&gt;';
      else if ('\\`*_[]~#'.includes(char)) text += `\\${char}`;
      else text += char;
    }
    text += parts[index + 1];
  }
  return text;
}
