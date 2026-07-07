import { Buffer } from 'node:buffer'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  accumulateReasoning,
  formatReasoningBlocks,
  parseReasoningChunk,
  reasoningBlocksFromMetadata,
  ReasoningChunkRenderer,
} from './reasoning'

function capture(): { err: PassThrough, errBuf: () => string } {
  const err = new PassThrough()
  const ec: Buffer[] = []
  err.on('data', d => ec.push(d as Buffer))
  return { err, errBuf: () => Buffer.concat(ec).toString('utf-8') }
}

describe('parseReasoningChunk', () => {
  it('reads the payload nested under data', () => {
    expect(parseReasoningChunk({ data: { reasoning: 'hi', node_id: 'llm-1', is_final: true } }))
      .toEqual({ reasoning: 'hi', nodeId: 'llm-1', isFinal: true })
  })

  it('defaults missing/wrong-typed fields', () => {
    expect(parseReasoningChunk({ data: {} })).toEqual({ reasoning: '', nodeId: '', isFinal: false })
  })

  it('returns undefined when data is absent or not an object', () => {
    expect(parseReasoningChunk({})).toBeUndefined()
    expect(parseReasoningChunk({ data: null })).toBeUndefined()
    expect(parseReasoningChunk({ data: ['x'] })).toBeUndefined()
  })
})

describe('ReasoningChunkRenderer', () => {
  it('frames streamed deltas with a node-tagged <think> open/close on the terminal marker', () => {
    const cap = capture()
    const r = new ReasoningChunkRenderer()
    r.push({ reasoning: 'pon', nodeId: 'llm-1', isFinal: false }, cap.err)
    r.push({ reasoning: 'dering', nodeId: 'llm-1', isFinal: false }, cap.err)
    r.push({ reasoning: '', nodeId: 'llm-1', isFinal: true }, cap.err)
    expect(cap.errBuf()).toBe('<think> [llm-1]\npondering</think>\n')
  })

  it('emits separate node-tagged blocks per node', () => {
    const cap = capture()
    const r = new ReasoningChunkRenderer()
    r.push({ reasoning: 'a', nodeId: 'n1', isFinal: true }, cap.err)
    r.push({ reasoning: 'b', nodeId: 'n2', isFinal: true }, cap.err)
    expect(cap.errBuf()).toBe('<think> [n1]\na</think>\n<think> [n2]\nb</think>\n')
  })

  it('tags each block with its node id so interleaved fragments stay distinguishable', () => {
    const cap = capture()
    const r = new ReasoningChunkRenderer()
    r.push({ reasoning: 'a1', nodeId: 'n1', isFinal: false }, cap.err)
    r.push({ reasoning: 'b1', nodeId: 'n2', isFinal: false }, cap.err)
    r.push({ reasoning: 'a2', nodeId: 'n1', isFinal: true }, cap.err)
    r.push({ reasoning: 'b2', nodeId: 'n2', isFinal: true }, cap.err)
    expect(cap.errBuf()).toBe(
      '<think> [n1]\na1</think>\n<think> [n2]\nb1</think>\n<think> [n1]\na2</think>\n<think> [n2]\nb2</think>\n',
    )
  })

  it('omits the tag when the chunk carries no node id', () => {
    const cap = capture()
    const r = new ReasoningChunkRenderer()
    r.push({ reasoning: 'plain', nodeId: '', isFinal: true }, cap.err)
    expect(cap.errBuf()).toBe('<think>\nplain</think>\n')
  })

  it('flush closes a block left open by a truncated stream', () => {
    const cap = capture()
    const r = new ReasoningChunkRenderer()
    r.push({ reasoning: 'half', nodeId: 'n1', isFinal: false }, cap.err)
    r.flush(cap.err)
    expect(cap.errBuf()).toBe('<think> [n1]\nhalf</think>\n')
  })

  it('a lone terminal marker with no reasoning emits nothing', () => {
    const cap = capture()
    const r = new ReasoningChunkRenderer()
    r.push({ reasoning: '', nodeId: 'n1', isFinal: true }, cap.err)
    expect(cap.errBuf()).toBe('')
  })
})

describe('accumulateReasoning', () => {
  it('appends deltas per node, falling back to "_" for a missing nodeId', () => {
    const acc: Record<string, string> = {}
    accumulateReasoning(acc, { reasoning: 'a', nodeId: 'n1', isFinal: false })
    accumulateReasoning(acc, { reasoning: 'b', nodeId: 'n1', isFinal: false })
    accumulateReasoning(acc, { reasoning: 'x', nodeId: '', isFinal: false })
    expect(acc).toEqual({ n1: 'ab', _: 'x' })
  })

  it('ignores empty reasoning', () => {
    const acc: Record<string, string> = {}
    accumulateReasoning(acc, { reasoning: '', nodeId: 'n1', isFinal: true })
    expect(acc).toEqual({})
  })
})

describe('formatReasoningBlocks', () => {
  it('frames and trims each node, joined by a separator', () => {
    expect(formatReasoningBlocks({ n1: '  one  ', n2: 'two' }))
      .toBe('<think>\none\n</think>\n---\n<think>\ntwo\n</think>')
  })

  it('skips empty entries and returns empty for no reasoning', () => {
    expect(formatReasoningBlocks({ n1: '   ' })).toBe('')
    expect(formatReasoningBlocks({})).toBe('')
  })
})

describe('reasoningBlocksFromMetadata', () => {
  it('extracts reasoning from a metadata object', () => {
    expect(reasoningBlocksFromMetadata({ reasoning: { n1: 'why' } }))
      .toBe('<think>\nwhy\n</think>')
  })

  it('returns empty for tagged mode (empty reasoning) and malformed input', () => {
    expect(reasoningBlocksFromMetadata({ reasoning: {} })).toBe('')
    expect(reasoningBlocksFromMetadata(undefined)).toBe('')
    expect(reasoningBlocksFromMetadata({ usage: { tokens: 1 } })).toBe('')
  })
})
