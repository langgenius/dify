function escapeName(value: string): string {
  return value
    .replace(/\r\n|\r|\n/g, '\r\n')
    .replace(/[\r\n"]/g, (character) =>
      character === '"' ? '%22' : character === '\r' ? '%0D' : '%0A',
    )
}

function headerValue(value: string): string {
  if (/[\x00-\x08\x0A-\x1F\x7F]/.test(value)) throw new Error('Invalid multipart content type')
  return value
}

/** Split parameters without treating semicolons inside quoted values as separators. */
function parameters(value: string): string[] {
  const parts: string[] = []
  let start = 0
  let quoted = false
  let escaped = false
  for (let index = 0; index < value.length; index++) {
    const character = value[index]
    if (escaped) escaped = false
    else if (quoted && character === '\\') escaped = true
    else if (character === '"') quoted = !quoted
    else if (character === ';' && !quoted) {
      parts.push(value.slice(start, index).trim())
      start = index + 1
    }
  }
  if (quoted || escaped) throw new Error('Invalid multipart content type')
  parts.push(value.slice(start).trim())
  return parts
}

/** Blob parts retain file bytes without reading entire files into JavaScript buffers. */
export function encodeMultipart(
  form: FormData,
  declaredType: string,
  jsonParts: readonly (readonly [string, string])[] = [],
): { body: Blob; contentType: string } {
  const boundary = `----dify-${globalThis.crypto.randomUUID()}`
  const chunks: BlobPart[] = []
  for (const [name, value] of form) {
    let header = `--${boundary}\r\nContent-Disposition: form-data; name="${escapeName(name)}"`
    if (typeof value === 'string') {
      chunks.push(`${header}\r\n\r\n`, value.replace(/\r\n|\r|\n/g, '\r\n'), '\r\n')
    } else {
      const type =
        jsonParts.find(([key]) => key === name)?.[1] ?? (value.type || 'application/octet-stream')
      header += `; filename="${escapeName(value.name)}"\r\nContent-Type: ${headerValue(type)}`
      chunks.push(`${header}\r\n\r\n`, value, '\r\n')
    }
  }
  chunks.push(`--${boundary}--\r\n`)
  const declared = parameters(headerValue(declaredType)).filter(
    (part, index) => index === 0 || part.split('=', 1)[0]?.trim().toLowerCase() !== 'boundary',
  )
  return {
    body: new Blob(chunks),
    contentType: `${declared.join('; ')}; boundary=${boundary}`,
  }
}
