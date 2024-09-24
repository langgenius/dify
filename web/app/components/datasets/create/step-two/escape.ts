function escape(input: string): string {
  if (!input || typeof input !== 'string')
    return ''

  const res = input
    .replaceAll('\\', '\\\\')
    .replaceAll('\0', '\\0')
    .replaceAll('\b', '\\b')
    .replaceAll('\f', '\\f')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t')
    .replaceAll('\v', '\\v')
    .replaceAll('\'', '\\\'')
  return res
}

export default escape
