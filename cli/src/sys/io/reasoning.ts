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

// Bucket key for a chunk; falls back to a single bucket so live rendering and
// buffered collection key reasoning the same way.
export function reasoningKey(chunk: ReasoningChunk): string {
  return chunk.nodeId !== '' ? chunk.nodeId : '_'
}

// Appends a reasoning delta to a per-node accumulator.
export function accumulateReasoning(acc: Record<string, string>, chunk: ReasoningChunk): void {
  if (chunk.reasoning === '')
    return
  const key = reasoningKey(chunk)
  acc[key] = (acc[key] ?? '') + chunk.reasoning
}

// Frames a live reasoning stream into stderr: <think> on the first delta,
// raw deltas thereafter, </think> on is_final. Parallel branches can interleave
// chunks from different nodes on one stream, so it keeps at most one block open
// and switches blocks on node change rather than merging them.
export class ReasoningChunkRenderer {
  private openNode: string | undefined

  push(chunk: ReasoningChunk, errOut: NodeJS.WritableStream): void {
    const key = reasoningKey(chunk)
    if (chunk.reasoning !== '') {
      if (this.openNode !== key) {
        this.closeActive(errOut)
        errOut.write(`${THINK_OPEN}\n`)
        this.openNode = key
      }
      errOut.write(chunk.reasoning)
    }
    if (chunk.isFinal && this.openNode === key)
      this.closeActive(errOut)
  }

  // Close a block left open by a truncated stream.
  flush(errOut: NodeJS.WritableStream): void {
    this.closeActive(errOut)
  }

  private closeActive(errOut: NodeJS.WritableStream): void {
    if (this.openNode === undefined)
      return
    errOut.write(`${THINK_CLOSE}\n`)
    this.openNode = undefined
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
