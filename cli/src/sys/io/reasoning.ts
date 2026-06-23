// Out-of-band reasoning ("separated" mode). When an LLM node sets
// reasoning_format=separated, the server keeps the answer stream free of
// <think> blocks and streams the chain-of-thought on its own `reasoning_chunk`
// SSE channel instead. This module renders that channel to stderr so --think
// looks identical whether reasoning arrives inline (tagged) or out-of-band
// (separated) — see think-filter.ts for the inline counterpart.

const THINK_OPEN = '<think>'
const THINK_CLOSE = '</think>'

export type ReasoningChunk = {
  reasoning: string
  nodeId: string
  isFinal: boolean
}

// A `reasoning_chunk` event nests its payload under `data` (unlike `message`
// events, whose `answer` sits at the top level). Returns undefined when the
// event carries no reasoning payload.
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

// Incrementally frames a separated reasoning stream into stderr the same way
// ThinkChunkFilter frames inline <think> blocks: `<think>\n` on the first delta,
// raw deltas thereafter, `</think>\n` on the terminal marker. Each LLM node's
// stream ends with is_final, so multiple nodes produce separate framed blocks.
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

  // Close a block left open by a truncated stream (no terminal marker arrived).
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

// Renders fully-buffered reasoning (one entry per LLM node id, as persisted in
// message_end metadata) into <think>-framed blocks, mirroring extractThinkBlocks.
export function formatReasoningBlocks(reasoning: Record<string, string>): string {
  const blocks: string[] = []
  for (const text of Object.values(reasoning)) {
    const trimmed = text.trim()
    if (trimmed !== '')
      blocks.push(`${THINK_OPEN}\n${trimmed}\n${THINK_CLOSE}`)
  }
  return blocks.join('\n---\n')
}

// Pulls per-node reasoning out of a message_end `metadata` object and frames it.
// Returns '' when metadata carries no (non-empty) reasoning — e.g. tagged mode,
// where the server sends `reasoning: {}`.
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
