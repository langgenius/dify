const OPEN = '<think>'
const CLOSE = '</think>'

export function stripThinkBlocks(s: string): string {
  return s.replace(/<think>[\s\S]*?<\/think>\r?\n?/g, '')
}

export function extractThinkBlocks(s: string): { clean: string; thinking: string } {
  const parts: string[] = []
  const clean = s.replace(/<think>([\s\S]*?)<\/think>\r?\n?/g, (_, content: string) => {
    parts.push(`<think>\n${content.trim()}\n</think>`)
    return ''
  })
  return { clean, thinking: parts.join('\n---\n') }
}

// Workflow outputs carry their answer text in top-level string fields rather than
// a single `answer`, so think filtering navigates the outputs object. Nested
// strings (inside arrays/objects) are left untouched.
export function filterThinkInOutputs(
  outputs: Record<string, unknown>,
  showThink: boolean,
): { outputs: Record<string, unknown>; thinking: string } {
  const thoughts: string[] = []
  const clean: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(outputs)) {
    if (typeof value !== 'string') {
      clean[key] = value
      continue
    }
    const extracted = extractThinkBlocks(value)
    clean[key] = extracted.clean
    if (showThink && extracted.thinking !== '') thoughts.push(extracted.thinking)
  }
  return { outputs: clean, thinking: thoughts.join('\n---\n') }
}

function splitAtPotentialTag(s: string, tag: string): [string, string] {
  const maxHold = tag.length - 1
  for (let len = Math.min(maxHold, s.length); len > 0; len--) {
    if (tag.startsWith(s.slice(-len))) {
      return [s.slice(0, -len), s.slice(-len)]
    }
  }
  return [s, '']
}

export class ThinkChunkFilter {
  private buf = ''
  private inThink = false
  private readonly showThink: boolean

  constructor(showThink: boolean) {
    this.showThink = showThink
  }

  push(chunk: string, out: NodeJS.WritableStream, errOut: NodeJS.WritableStream): void {
    let s = this.buf + chunk
    this.buf = ''

    while (s.length > 0) {
      if (!this.inThink) {
        const idx = s.indexOf(OPEN)
        if (idx === -1) {
          const [safe, held] = splitAtPotentialTag(s, OPEN)
          if (safe) out.write(safe)
          this.buf = held
          return
        }
        if (idx > 0) out.write(s.slice(0, idx))
        s = s.slice(idx + OPEN.length)
        this.inThink = true
        if (this.showThink) errOut.write(`${OPEN}\n`)
        continue
      }

      // inThink = true
      const idx = s.indexOf(CLOSE)
      if (idx === -1) {
        const [safe, held] = splitAtPotentialTag(s, CLOSE)
        if (safe && this.showThink) errOut.write(safe)
        this.buf = held
        return
      }
      if (idx > 0 && this.showThink) errOut.write(s.slice(0, idx))
      if (this.showThink) errOut.write(`${CLOSE}\n`)
      s = s.slice(idx + CLOSE.length)
      this.inThink = false
      if (s.startsWith('\r\n')) s = s.slice(2)
      else if (s.startsWith('\n')) s = s.slice(1)
    }
  }

  flush(out: NodeJS.WritableStream, errOut: NodeJS.WritableStream): void {
    if (this.buf === '') return
    if (this.inThink) {
      if (this.showThink) errOut.write(this.buf)
    } else {
      out.write(this.buf)
    }
    this.buf = ''
    this.inThink = false
  }
}
