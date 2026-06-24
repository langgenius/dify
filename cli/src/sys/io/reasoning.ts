// Renders "separated"-mode reasoning (streamed on its own `reasoning_chunk` SSE
// channel) to stderr, so --think matches inline <think> (see think-filter.ts).

const THINK_OPEN = '<think>'
const THINK_CLOSE = '</think>'

export type ReasoningChunk = {
  reasoning: string
  nodeId: string
  isFinal: boolean
}

// reasoning_chunk nests its payload under `data` (not top-level like `message`).
export function parseReasoningChunk(parsed: Record<string, unknown>): ReasoningChunk | undefined {
  const data = parsed.data
  if (data === null || typeof data !== 'object' || Array.isArray(data))
    return undefined
  const rec = data as Record<string, unknown>
  return {
    reasoning: typeof rec.reasoning === 'string' ? rec.reasoning : '',
    nodeId: typeof rec.node_id === 'string' ? rec.node_id : '',
    isFinal: rec.is_final === true,
  }
}

// Frames a live reasoning stream into stderr: <think> on the first delta,
// raw deltas thereafter, </think> on is_final.
export class ReasoningChunkRenderer {
  private open = false

  push(chunk: ReasoningChunk, errOut: NodeJS.WritableStream): void {
    if (chunk.reasoning !== '') {
      if (!this.open) {
        errOut.write(`${THINK_OPEN}\n`)
        this.open = true
      }
      errOut.write(chunk.reasoning)
    }
    if (chunk.isFinal)
      this.close(errOut)
  }

  // Close a block left open by a truncated stream.
  flush(errOut: NodeJS.WritableStream): void {
    this.close(errOut)
  }

  private close(errOut: NodeJS.WritableStream): void {
    if (!this.open)
      return
    errOut.write(`${THINK_CLOSE}\n`)
    this.open = false
  }
}

// Frames fully-buffered reasoning (one entry per LLM node id) into <think> blocks.
export function formatReasoningBlocks(reasoning: Record<string, string>): string {
  const blocks: string[] = []
  for (const text of Object.values(reasoning)) {
    const trimmed = text.trim()
    if (trimmed !== '')
      blocks.push(`${THINK_OPEN}\n${trimmed}\n${THINK_CLOSE}`)
  }
  return blocks.join('\n---\n')
}

// Frames per-node reasoning from a message_end `metadata` object; '' when absent.
export function reasoningBlocksFromMetadata(metadata: unknown): string {
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata))
    return ''
  const reasoning = (metadata as Record<string, unknown>).reasoning
  if (reasoning === null || typeof reasoning !== 'object' || Array.isArray(reasoning))
    return ''
  const map: Record<string, string> = {}
  for (const [key, value] of Object.entries(reasoning as Record<string, unknown>)) {
    if (typeof value === 'string')
      map[key] = value
  }
  return formatReasoningBlocks(map)
}
