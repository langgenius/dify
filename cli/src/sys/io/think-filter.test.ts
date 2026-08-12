import { Buffer } from 'node:buffer'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  extractThinkBlocks,
  filterThinkInOutputs,
  stripThinkBlocks,
  ThinkChunkFilter,
} from './think-filter'

function captures() {
  const out = new PassThrough()
  const err = new PassThrough()
  const oc: Buffer[] = []
  out.on('data', (d: Buffer) => oc.push(d))
  const ec: Buffer[] = []
  err.on('data', (d: Buffer) => ec.push(d))
  return {
    out,
    err,
    outBuf: () => Buffer.concat(oc).toString('utf-8'),
    errBuf: () => Buffer.concat(ec).toString('utf-8'),
  }
}

// --- bulk helpers ---

describe('stripThinkBlocks', () => {
  it('no think block — unchanged', () => {
    expect(stripThinkBlocks('hello world')).toBe('hello world')
  })

  it('strips single think block at start', () => {
    expect(stripThinkBlocks('<think>reasoning</think>\nhello')).toBe('hello')
  })

  it('strips multiple think blocks', () => {
    expect(stripThinkBlocks('<think>a</think>\nfoo<think>b</think>\nbar')).toBe('foobar')
  })

  it('strips multi-line think block', () => {
    const s = '<think>\nline1\nline2\n</think>\nanswer'
    expect(stripThinkBlocks(s)).toBe('answer')
  })

  it('empty string unchanged', () => {
    expect(stripThinkBlocks('')).toBe('')
  })
})

describe('extractThinkBlocks', () => {
  it('no think block — clean equals input, thinking empty', () => {
    const r = extractThinkBlocks('hello')
    expect(r.clean).toBe('hello')
    expect(r.thinking).toBe('')
  })

  it('single block — separates thinking and clean', () => {
    const r = extractThinkBlocks('<think>step 1</think>\nfinal answer')
    expect(r.clean).toBe('final answer')
    expect(r.thinking).toBe('<think>\nstep 1\n</think>')
  })

  it('multiple blocks — thinking joined with separator', () => {
    const r = extractThinkBlocks('<think>a</think>\nfoo<think>b</think>\nbar')
    expect(r.clean).toBe('foobar')
    expect(r.thinking).toBe('<think>\na\n</think>\n---\n<think>\nb\n</think>')
  })
})

// --- workflow outputs helper ---

describe('filterThinkInOutputs', () => {
  it('no think block — outputs unchanged, thinking empty', () => {
    const r = filterThinkInOutputs({ text: 'hello' }, true)
    expect(r.outputs).toEqual({ text: 'hello' })
    expect(r.thinking).toBe('')
  })

  it('showThink: false — strips from string field, thinking empty', () => {
    const r = filterThinkInOutputs({ text: '<think>reasoning</think>\nanswer' }, false)
    expect(r.outputs).toEqual({ text: 'answer' })
    expect(r.thinking).toBe('')
  })

  it('showThink: true — strips from string field, captures thinking', () => {
    const r = filterThinkInOutputs({ text: '<think>step 1</think>\nfinal' }, true)
    expect(r.outputs).toEqual({ text: 'final' })
    expect(r.thinking).toBe('<think>\nstep 1\n</think>')
  })

  it('multiple string fields — thinking joined with separator', () => {
    const r = filterThinkInOutputs({ a: '<think>x</think>\nfoo', b: '<think>y</think>\nbar' }, true)
    expect(r.outputs).toEqual({ a: 'foo', b: 'bar' })
    expect(r.thinking).toBe('<think>\nx\n</think>\n---\n<think>\ny\n</think>')
  })

  it('non-string values pass through untouched', () => {
    const outputs = {
      n: 42,
      flag: true,
      nested: { k: '<think>v</think>\nx' },
      arr: ['a'],
      nil: null,
    }
    const r = filterThinkInOutputs(outputs, true)
    expect(r.outputs).toEqual(outputs)
    expect(r.thinking).toBe('')
  })

  it('empty outputs — empty result', () => {
    const r = filterThinkInOutputs({}, true)
    expect(r.outputs).toEqual({})
    expect(r.thinking).toBe('')
  })
})

// --- streaming chunk filter ---

describe('ThinkChunkFilter — showThink: false (strip)', () => {
  it('passes normal text through to out', () => {
    const cap = captures()
    const f = new ThinkChunkFilter(false)
    f.push('hello world', cap.out, cap.err)
    f.flush(cap.out, cap.err)
    expect(cap.outBuf()).toBe('hello world')
    expect(cap.errBuf()).toBe('')
  })

  it('strips think block in single chunk', () => {
    const cap = captures()
    const f = new ThinkChunkFilter(false)
    f.push('<think>secret</think>\nvisible', cap.out, cap.err)
    f.flush(cap.out, cap.err)
    expect(cap.outBuf()).toBe('visible')
    expect(cap.errBuf()).toBe('')
  })

  it('strips think block split across two chunks', () => {
    const cap = captures()
    const f = new ThinkChunkFilter(false)
    f.push('<think>sec', cap.out, cap.err)
    f.push('ret</think>\nvisible', cap.out, cap.err)
    f.flush(cap.out, cap.err)
    expect(cap.outBuf()).toBe('visible')
    expect(cap.errBuf()).toBe('')
  })

  it('strips when tag boundary splits mid-<think>', () => {
    const cap = captures()
    const f = new ThinkChunkFilter(false)
    f.push('pre<thi', cap.out, cap.err)
    f.push('nk>hidden</think>\nafter', cap.out, cap.err)
    f.flush(cap.out, cap.err)
    expect(cap.outBuf()).toBe('preafter')
    expect(cap.errBuf()).toBe('')
  })

  it('strips when close tag boundary splits mid-</think>', () => {
    const cap = captures()
    const f = new ThinkChunkFilter(false)
    f.push('<think>think</thi', cap.out, cap.err)
    f.push('nk>\nafter', cap.out, cap.err)
    f.flush(cap.out, cap.err)
    expect(cap.outBuf()).toBe('after')
    expect(cap.errBuf()).toBe('')
  })

  it('strips multiple think blocks across chunks', () => {
    const cap = captures()
    const f = new ThinkChunkFilter(false)
    f.push('<think>a</think>\nfoo', cap.out, cap.err)
    f.push('<think>b</think>\nbar', cap.out, cap.err)
    f.flush(cap.out, cap.err)
    expect(cap.outBuf()).toBe('foobar')
  })

  it('flush emits buffered normal text', () => {
    const cap = captures()
    const f = new ThinkChunkFilter(false)
    f.push('hel', cap.out, cap.err)
    f.push('lo', cap.out, cap.err)
    f.flush(cap.out, cap.err)
    expect(cap.outBuf()).toBe('hello')
  })
})

describe('ThinkChunkFilter — showThink: true (route to stderr)', () => {
  it('routes think content to stderr with tags, normal text to stdout', () => {
    const cap = captures()
    const f = new ThinkChunkFilter(true)
    f.push('<think>reasoning</think>\nanswer', cap.out, cap.err)
    f.flush(cap.out, cap.err)
    expect(cap.outBuf()).toBe('answer')
    expect(cap.errBuf()).toBe('<think>\nreasoning</think>\n')
  })

  it('routes multi-chunk think content to stderr with tags', () => {
    const cap = captures()
    const f = new ThinkChunkFilter(true)
    f.push('<think>part1 ', cap.out, cap.err)
    f.push('part2</think>\nans', cap.out, cap.err)
    f.flush(cap.out, cap.err)
    expect(cap.errBuf()).toBe('<think>\npart1 part2</think>\n')
    expect(cap.outBuf()).toBe('ans')
  })

  it('flush emits remaining inThink buffer to stderr', () => {
    const cap = captures()
    const f = new ThinkChunkFilter(true)
    f.push('<think>incomplete', cap.out, cap.err)
    f.flush(cap.out, cap.err)
    expect(cap.errBuf()).toContain('<think>')
    expect(cap.errBuf()).toContain('incomplete')
    expect(cap.outBuf()).toBe('')
  })

  it('split close-tag boundary routes partial think to stderr with tags', () => {
    const cap = captures()
    const f = new ThinkChunkFilter(true)
    f.push('<think>content</thi', cap.out, cap.err)
    f.push('nk>\nafter', cap.out, cap.err)
    f.flush(cap.out, cap.err)
    expect(cap.errBuf()).toBe('<think>\ncontent</think>\n')
    expect(cap.outBuf()).toBe('after')
  })
})

describe('ThinkChunkFilter — flush with inThink=false drops nothing', () => {
  it('showThink=false + unclosed think: flush emits nothing to either stream', () => {
    const cap = captures()
    const f = new ThinkChunkFilter(false)
    f.push('<think>secret content', cap.out, cap.err)
    f.flush(cap.out, cap.err)
    expect(cap.outBuf()).toBe('')
    expect(cap.errBuf()).toBe('')
  })
})
