// JSON inside a script element must not permit a title to terminate the element.
export function safeJson(value: unknown): string {
  return (JSON.stringify(value) ?? 'null').replaceAll('<', '\\u003c');
}
