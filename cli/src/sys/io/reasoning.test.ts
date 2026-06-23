import { Buffer } from 'node:buffer'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
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
  it('frames streamed deltas with <think> open/close on the terminal marker', () => {
    const cap = capture()
    const r = new ReasoningChunkRenderer()
    r.push({ reasoning: 'pon', nodeId: 'llm-1', isFinal: false }, cap.err)
    r.push({ reasoning: 'dering', nodeId: 'llm-1', isFinal: false }, cap.err)
    r.push({ reasoning: '', nodeId: 'llm-1', isFinal: true }, cap.err)
    expect(cap.errBuf()).toBe('<think>\npondering</think>\n')
  })

  it('emits separate blocks per node', () => {
    const cap = capture()
    const r = new ReasoningChunkRenderer()
    r.push({ reasoning: 'a', nodeId: 'n1', isFinal: true }, cap.err)
    r.push({ reasoning: 'b', nodeId: 'n2', isFinal: true }, cap.err)
    expect(cap.errBuf()).toBe('<think>\na</think>\n<think>\nb</think>\n')
  })

  it('flush closes a block left open by a truncated stream', () => {
    const cap = capture()
    const r = new ReasoningChunkRenderer()
    r.push({ reasoning: 'half', nodeId: 'n1', isFinal: false }, cap.err)
    r.flush(cap.err)
    expect(cap.errBuf()).toBe('<think>\nhalf</think>\n')
  })

  it('a lone terminal marker with no reasoning emits nothing', () => {
    const cap = capture()
    const r = new ReasoningChunkRenderer()
    r.push({ reasoning: '', nodeId: 'n1', isFinal: true }, cap.err)
    expect(cap.errBuf()).toBe('')
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
