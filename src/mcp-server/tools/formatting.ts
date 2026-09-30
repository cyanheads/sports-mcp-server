/**
 * @fileoverview Flatten inline data without changing authored Markdown or structured values.
 * @module mcp-server/tools/formatting
 */

/** Template tag that keeps every interpolated value on its authored line. */
export function inline(parts: TemplateStringsArray, ...values: Array<string | number>): string {
  return parts.reduce(
    (text, part, index) =>
      text +
      part +
      (index < values.length ? String(values[index]).replace(/\r\n|[\r\n]/g, ' ') : ''),
    '',
  );
}
