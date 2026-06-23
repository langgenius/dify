import type { SseEvent } from '@/http/sse'
import { Buffer } from 'node:buffer'
import { PassThrough, Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { HitlPauseError } from './sse-collector'
import { streamPrinterFor } from './stream-handlers'

const enc = new TextEncoder()
function ev(name: string, data: object): SseEvent {
  return { name, data: enc.encode(JSON.stringify(data)) }
}

function captures(): { out: PassThrough, err: PassThrough, outBuf: () => string, errBuf: () => string } {
  const out = new PassThrough()
  const err = new PassThrough()
  const oc: Buffer[] = []
  out.on('data', d => oc.push(d as Buffer))
  const ec: Buffer[] = []
  err.on('data', d => ec.push(d as Buffer))
  return {
    out,
    err,
    outBuf: () => Buffer.concat(oc).toString('utf-8'),
    errBuf: () => Buffer.concat(ec).toString('utf-8'),
  }
}

describe('streamPrinterFor — chat', () => {
  it('prints answer chunks live and conversation hint on end', () => {
    const sp = streamPrinterFor('chat')
    const cap = captures()
    sp.onEvent(cap.out, cap.err, ev('message', { conversation_id: 'c1', answer: 'hello ' }))
    sp.onEvent(cap.out, cap.err, ev('message', { answer: 'world' }))
    sp.onEnd(cap.out, cap.err)
    expect(cap.outBuf()).toBe('hello world\n')
    expect(cap.errBuf()).toContain('--conversation c1')
  })
})

function reasoningEvent(reasoning: string, isFinal: boolean) {
  return ev('reasoning_chunk', { data: { message_id: 'm1', reasoning, node_id: 'llm-1', is_final: isFinal } })
}

describe('streamPrinterFor — chat separated reasoning', () => {
  it('think: true frames reasoning_chunk deltas to stderr, answer stays clean on stdout', () => {
    const sp = streamPrinterFor('advanced-chat', true)
    const cap = captures()
    sp.onEvent(cap.out, cap.err, reasoningEvent('pon', false))
    sp.onEvent(cap.out, cap.err, reasoningEvent('dering', false))
    sp.onEvent(cap.out, cap.err, reasoningEvent('', true))
    sp.onEvent(cap.out, cap.err, ev('message', { conversation_id: 'c1', answer: 'final answer' }))
    sp.onEnd(cap.out, cap.err)
    expect(cap.errBuf()).toContain('<think>\npondering</think>')
    expect(cap.outBuf()).toBe('final answer\n')
  })

  it('think: false ignores reasoning_chunk entirely', () => {
    const sp = streamPrinterFor('advanced-chat', false)
    const cap = captures()
    sp.onEvent(cap.out, cap.err, reasoningEvent('secret', true))
    sp.onEvent(cap.out, cap.err, ev('message', { answer: 'hi' }))
    sp.onEnd(cap.out, cap.err)
    expect(cap.errBuf()).not.toContain('secret')
    expect(cap.outBuf()).toBe('hi\n')
  })

  it('closes an unterminated reasoning block on stream end', () => {
    const sp = streamPrinterFor('advanced-chat', true)
    const cap = captures()
    sp.onEvent(cap.out, cap.err, reasoningEvent('thinking', false))
    sp.onEnd(cap.out, cap.err)
    expect(cap.errBuf()).toContain('<think>\nthinking</think>')
  })
})

describe('streamPrinterFor — agent-chat', () => {
  it('writes agent_thought to stderr', () => {
    const sp = streamPrinterFor('agent-chat')
    const cap = captures()
    sp.onEvent(cap.out, cap.err, ev('agent_thought', { thought: 'thinking' }))
    sp.onEvent(cap.out, cap.err, ev('agent_message', { answer: 'done' }))
    sp.onEnd(cap.out, cap.err)
    expect(cap.errBuf()).toContain('thought: thinking')
    expect(cap.outBuf()).toContain('done')
  })
})

describe('streamPrinterFor — completion', () => {
  it('prints answers + trailing newline', () => {
    const sp = streamPrinterFor('completion')
    const cap = captures()
    sp.onEvent(cap.out, cap.err, ev('message', { answer: 'foo' }))
    sp.onEvent(cap.out, cap.err, ev('message', { answer: 'bar' }))
    sp.onEnd(cap.out, cap.err)
    expect(cap.outBuf()).toBe('foobar\n')
  })
})

describe('streamPrinterFor — workflow', () => {
  it('streams node titles to stderr and outputs JSON on end', () => {
    const sp = streamPrinterFor('workflow')
    const cap = captures()
    sp.onEvent(cap.out, cap.err, ev('node_started', { title: 'A' }))
    sp.onEvent(cap.out, cap.err, ev('node_finished', { id: 'a', status: 'succeeded' }))
    sp.onEvent(cap.out, cap.err, ev('workflow_finished', { data: { outputs: { x: 1 } } }))
    sp.onEnd(cap.out, cap.err)
    expect(cap.errBuf()).toContain('→ A')
    const parsed = JSON.parse(cap.outBuf().trim()) as { x: number }
    expect(parsed.x).toBe(1)
  })
})

describe('streamPrinterFor — workflow think filtering', () => {
  it('think: false (default) strips <think> from string outputs, nothing to stderr', () => {
    const sp = streamPrinterFor('workflow')
    const cap = captures()
    sp.onEvent(cap.out, cap.err, ev('workflow_finished', { data: { outputs: { text: '<think>hidden</think>\nresult' } } }))
    sp.onEnd(cap.out, cap.err)
    const parsed = JSON.parse(cap.outBuf().trim()) as { text: string }
    expect(parsed.text).toBe('result')
    expect(cap.errBuf()).toBe('')
  })

  it('think: true strips <think> from string outputs and routes thinking to stderr', () => {
    const sp = streamPrinterFor('workflow', true)
    const cap = captures()
    sp.onEvent(cap.out, cap.err, ev('workflow_finished', { data: { outputs: { text: '<think>reasoning</think>\nresult' } } }))
    sp.onEnd(cap.out, cap.err)
    const parsed = JSON.parse(cap.outBuf().trim()) as { text: string }
    expect(parsed.text).toBe('result')
    expect(cap.errBuf()).toContain('<think>')
    expect(cap.errBuf()).toContain('reasoning')
  })

  it('array outputs pass through unchanged (not reshaped into an object)', () => {
    const sp = streamPrinterFor('workflow', true)
    const cap = captures()
    sp.onEvent(cap.out, cap.err, ev('workflow_finished', { data: { outputs: ['a', 'b'] } }))
    sp.onEnd(cap.out, cap.err)
    expect(cap.outBuf().trim()).toBe('["a","b"]')
  })
})

describe('streamPrinterFor — unknown mode', () => {
  it('throws', () => {
    expect(() => streamPrinterFor('whatever')).toThrow()
  })
})

function capture(): { stream: Writable, buf: () => string } {
  const chunks: Buffer[] = []
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.from(chunk as ArrayBuffer))
      cb()
    },
  })
  return { stream, buf: () => Buffer.concat(chunks).toString() }
}

describe('streamPrinterFor — HITL events', () => {
  it('throws HitlPauseError on human_input_required', () => {
    const sp = streamPrinterFor('workflow')
    const { stream } = capture()
    const hitl = {
      task_id: 't-1',
      workflow_run_id: 'wf-1',
      data: {
        form_id: 'form-1',
        node_id: 'n1',
        node_title: 'First',
        form_content: 'fill',
        inputs: [],
        actions: [],
        display_in_ui: false,
        form_token: 'ft-1',
        resolved_default_values: {},
        expiration_time: 999,
      },
    }
    expect(() => sp.onEvent(stream, stream, ev('human_input_required', hitl))).toThrow(HitlPauseError)
  })
})

describe('streamPrinterFor — silent events', () => {
  it('silently ignores iteration_started', () => {
    const sp = streamPrinterFor('workflow')
    const { stream } = capture()
    expect(() => sp.onEvent(stream, stream, ev('iteration_started', { id: 'i-1' }))).not.toThrow()
  })

  it('silently ignores node_retry', () => {
    const sp = streamPrinterFor('chat')
    const { stream } = capture()
    expect(() => sp.onEvent(stream, stream, ev('node_retry', { id: 'n1' }))).not.toThrow()
  })
})

describe('streamPrinterFor — think: false strips think blocks from streamed answer', () => {
  it('chat: strips think block from live answer chunk', () => {
    const sp = streamPrinterFor('chat', false)
    const cap = captures()
    sp.onEvent(cap.out, cap.err, ev('message', { conversation_id: 'c1', answer: '<think>reasoning</think>\nhello' }))
    sp.onEnd(cap.out, cap.err)
    expect(cap.outBuf()).toBe('hello\n')
    expect(cap.errBuf()).not.toContain('reasoning')
  })

  it('chat: strips think block split across two events', () => {
    const sp = streamPrinterFor('chat', false)
    const cap = captures()
    sp.onEvent(cap.out, cap.err, ev('message', { answer: '<think>sec' }))
    sp.onEvent(cap.out, cap.err, ev('message', { answer: 'ret</think>\nfinal' }))
    sp.onEnd(cap.out, cap.err)
    expect(cap.outBuf()).toBe('final\n')
  })

  it('completion: strips think block', () => {
    const sp = streamPrinterFor('completion', false)
    const cap = captures()
    sp.onEvent(cap.out, cap.err, ev('message', { answer: '<think>hidden</think>\nresult' }))
    sp.onEnd(cap.out, cap.err)
    expect(cap.outBuf()).toBe('result\n')
  })
})

describe('streamPrinterFor — think: true routes thinking to stderr', () => {
  it('chat: routes think block to stderr', () => {
    const sp = streamPrinterFor('chat', true)
    const cap = captures()
    sp.onEvent(cap.out, cap.err, ev('message', { answer: '<think>my reasoning</think>\nanswer text' }))
    sp.onEnd(cap.out, cap.err)
    expect(cap.outBuf()).toBe('answer text\n')
    expect(cap.errBuf()).toContain('my reasoning')
  })

  it('completion: routes think block to stderr', () => {
    const sp = streamPrinterFor('completion', true)
    const cap = captures()
    sp.onEvent(cap.out, cap.err, ev('message', { answer: '<think>thought</think>\nout' }))
    sp.onEnd(cap.out, cap.err)
    expect(cap.outBuf()).toBe('out\n')
    expect(cap.errBuf()).toContain('thought')
  })
})

describe('streamPrinterFor — no-think param = backward compat (strips by default)', () => {
  it('existing call without think param still strips', () => {
    const sp = streamPrinterFor('chat')
    const cap = captures()
    sp.onEvent(cap.out, cap.err, ev('message', { answer: '<think>x</think>\nok' }))
    sp.onEnd(cap.out, cap.err)
    expect(cap.outBuf()).toBe('ok\n')
  })
})
