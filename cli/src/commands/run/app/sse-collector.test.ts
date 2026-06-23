import type { HttpClientError } from '@/errors/base'
import type { SseEvent } from '@/http/sse'
import { describe, expect, it } from 'vitest'
import { collect, collectorFor, decodeStreamError, HitlPauseError } from './sse-collector'

const enc = new TextEncoder()
function ev(name: string, data: object): SseEvent {
  return { name, data: enc.encode(JSON.stringify(data)) }
}

async function* iterOf(...evs: SseEvent[]): AsyncIterable<SseEvent> {
  for (const e of evs) yield e
}

describe('collectorFor', () => {
  it('throws for unknown mode', () => {
    expect(() => collectorFor('whatever')).toThrow()
  })

  it.each(['chat', 'advanced-chat', 'agent-chat', 'completion', 'workflow'])(
    'returns collector for %s',
    (m) => {
      expect(collectorFor(m)).toBeDefined()
    },
  )
})

describe('collect — chat', () => {
  it('aggregates message + message_end into blocking shape', async () => {
    const got = await collect(iterOf(
      ev('message', { conversation_id: 'c1', message_id: 'm1', mode: 'chat', answer: 'hello ' }),
      ev('message', { answer: 'world' }),
      ev('message_end', { metadata: { usage: { tokens: 5 } } }),
    ), 'chat')
    expect(got).toMatchObject({
      mode: 'chat',
      answer: 'hello world',
      conversation_id: 'c1',
      message_id: 'm1',
      metadata: { usage: { tokens: 5 } },
    })
  })

  it('drops ping events', async () => {
    const got = await collect(iterOf(
      ev('ping', {}),
      ev('message', { answer: 'x' }),
      ev('ping', {}),
    ), 'chat')
    expect(got.answer).toBe('x')
  })

  it('ignores unknown event names', async () => {
    const got = await collect(iterOf(
      ev('weird_future_event', { whatever: true }),
      ev('message', { answer: 'x' }),
    ), 'chat')
    expect(got.answer).toBe('x')
  })
})

describe('collect — chat separated reasoning', () => {
  function reasoningEvent(reasoning: string, isFinal: boolean) {
    return ev('reasoning_chunk', { data: { message_id: 'm1', reasoning, node_id: 'llm-1', is_final: isFinal } })
  }

  it('backfills metadata.reasoning from live deltas when the server omits it', async () => {
    const got = await collect(iterOf(
      reasoningEvent('pon', false),
      reasoningEvent('dering', true),
      ev('message', { message_id: 'm1', answer: 'answer' }),
      ev('message_end', { metadata: { usage: { tokens: 3 } } }),
    ), 'advanced-chat')
    expect(got.answer).toBe('answer')
    expect((got.metadata as { reasoning?: unknown }).reasoning).toEqual({ 'llm-1': 'pondering' })
    expect((got.metadata as { usage?: unknown }).usage).toEqual({ tokens: 3 })
  })

  it('keeps the server-persisted reasoning over live deltas', async () => {
    const got = await collect(iterOf(
      reasoningEvent('live', true),
      ev('message', { answer: 'a' }),
      ev('message_end', { metadata: { reasoning: { 'llm-1': 'persisted' } } }),
    ), 'advanced-chat')
    expect((got.metadata as { reasoning?: unknown }).reasoning).toEqual({ 'llm-1': 'persisted' })
  })

  it('leaves metadata untouched when there is no reasoning at all', async () => {
    const got = await collect(iterOf(
      ev('message', { answer: 'a' }),
      ev('message_end', { metadata: { usage: { tokens: 1 } } }),
    ), 'advanced-chat')
    expect((got.metadata as { reasoning?: unknown }).reasoning).toBeUndefined()
  })
})

describe('collect — agent-chat', () => {
  it('captures agent_thoughts', async () => {
    const got = await collect(iterOf(
      ev('agent_thought', { thought: 'first' }),
      ev('agent_message', { answer: 'a' }),
      ev('agent_thought', { thought: 'second' }),
      ev('agent_message', { answer: 'b' }),
    ), 'agent-chat')
    expect(got.answer).toBe('ab')
    expect(Array.isArray(got.agent_thoughts)).toBe(true)
    expect((got.agent_thoughts as unknown[]).length).toBe(2)
  })
})

describe('collect — completion', () => {
  it('aggregates message events into answer', async () => {
    const got = await collect(iterOf(
      ev('message', { mode: 'completion', message_id: 'm1', answer: 'foo' }),
      ev('message', { answer: 'bar' }),
      ev('message_end', { metadata: {} }),
    ), 'completion')
    expect(got).toMatchObject({ mode: 'completion', answer: 'foobar', message_id: 'm1' })
  })
})

describe('collect — workflow', () => {
  it('captures only workflow_finished payload', async () => {
    const got = await collect(iterOf(
      ev('workflow_started', { id: 'wf' }),
      ev('node_started', { id: 'n1' }),
      ev('node_finished', { id: 'n1', status: 'succeeded' }),
      ev('workflow_finished', { data: { status: 'succeeded', outputs: { x: 1 } } }),
    ), 'workflow')
    expect(got.mode).toBe('workflow')
    expect((got.data as { outputs: { x: number } }).outputs.x).toBe(1)
  })
})

describe('collect — error event', () => {
  it('throws BaseError when error event arrives', async () => {
    await expect(collect(iterOf(
      ev('error', { message: 'boom', status: 503 }),
    ), 'chat')).rejects.toMatchObject({ code: 'server_5xx', message: 'boom' })
  })
})

describe('decodeStreamError', () => {
  it('maps status >= 500 to Server5xx', () => {
    const err = decodeStreamError(enc.encode(JSON.stringify({ message: 'x', status: 500 })))
    expect(err.code).toBe('server_5xx')
  })

  it('maps status < 500 to Server4xxOther', () => {
    const err = decodeStreamError(enc.encode(JSON.stringify({ message: 'x', status: 400 })))
    expect(err.code).toBe('server_4xx_other')
  })

  it('falls back to default message on empty data', () => {
    const err = decodeStreamError(new Uint8Array())
    expect(err.message).toMatch(/error event/i)
  })

  it('unwraps openapi-v1 invoke-error: prefers args.description', () => {
    const inner = {
      args: { description: '[models] Error: API request failed with status code 402: Insufficient Balance' },
      error_type: 'InvokeError',
      message: 'fallback message',
    }
    const env = { message: JSON.stringify(inner), status: 400 }
    const err = decodeStreamError(enc.encode(JSON.stringify(env)))
    expect(err.message).toBe(inner.args.description)
    expect(err.code).toBe('server_4xx_other')
    expect((err as HttpClientError).httpStatus).toBe(400)
  })

  it('unwraps openapi-v1 invoke-error: falls back to inner.message when no args.description', () => {
    const inner = { error_type: 'InvokeError', message: 'inner only' }
    const env = { message: JSON.stringify(inner), status: 500 }
    const err = decodeStreamError(enc.encode(JSON.stringify(env)))
    expect(err.message).toBe('inner only')
    expect(err.code).toBe('server_5xx')
  })

  it('leaves message untouched when env.message is plain text', () => {
    const env = { message: 'plain text error', status: 400 }
    const err = decodeStreamError(enc.encode(JSON.stringify(env)))
    expect(err.message).toBe('plain text error')
  })

  it('leaves message untouched when nested JSON lacks error_type', () => {
    const env = { message: JSON.stringify({ foo: 'bar' }), status: 400 }
    const err = decodeStreamError(enc.encode(JSON.stringify(env)))
    expect(err.message).toBe(JSON.stringify({ foo: 'bar' }))
  })

  it('leaves message untouched on malformed nested JSON starting with {', () => {
    const env = { message: '{not valid json', status: 400 }
    const err = decodeStreamError(enc.encode(JSON.stringify(env)))
    expect(err.message).toBe('{not valid json')
  })
})

describe('collect — human_input_required', () => {
  it('throws HitlPauseError when human_input_required arrives', async () => {
    const hitlData = {
      task_id: 'task-1',
      workflow_run_id: 'wf-run-1',
      data: {
        form_id: 'form-1',
        node_id: 'n1',
        node_title: 'First',
        form_content: 'Please fill in',
        inputs: [],
        actions: [{ id: 'submit', title: 'Submit' }],
        display_in_ui: false,
        form_token: 'ft-1',
        resolved_default_values: {},
        expiration_time: 9999999999,
      },
    }
    await expect(collect(iterOf(
      ev('workflow_started', {}),
      ev('human_input_required', hitlData),
    ), 'workflow')).rejects.toBeInstanceOf(HitlPauseError)
  })

  it('HitlPauseError carries the pause payload', async () => {
    const hitlData = {
      task_id: 'task-1',
      workflow_run_id: 'wf-run-1',
      data: {
        form_id: 'form-1',
        node_id: 'n1',
        node_title: 'First',
        form_content: 'form',
        inputs: [],
        actions: [],
        display_in_ui: false,
        form_token: 'ft-abc',
        resolved_default_values: { name: 'Alice' },
        expiration_time: 9999999999,
      },
    }
    let caught: HitlPauseError | undefined
    try {
      await collect(iterOf(ev('human_input_required', hitlData)), 'workflow')
    }
    catch (e) {
      if (e instanceof HitlPauseError)
        caught = e
    }
    expect(caught).toBeDefined()
    expect(caught!.pausePayload.data.form_token).toBe('ft-abc')
    expect(caught!.pausePayload.data.resolved_default_values).toEqual({ name: 'Alice' })
  })
})

describe('collect — silent events', () => {
  it('silently ignores iteration_started and loop_started', async () => {
    const got = await collect(iterOf(
      ev('iteration_started', { id: 'iter-1' }),
      ev('loop_started', { id: 'loop-1' }),
      ev('node_started', {}),
      ev('message', { answer: 'x' }),
    ), 'chat')
    expect(got.answer).toBe('x')
  })

  it('silently ignores node_retry', async () => {
    const got = await collect(iterOf(
      ev('node_retry', { id: 'n1', retry: 1 }),
      ev('message', { answer: 'ok' }),
    ), 'chat')
    expect(got.answer).toBe('ok')
  })

  it('workflow_paused without prior HITL throws a plain error', async () => {
    await expect(collect(iterOf(
      ev('workflow_started', {}),
      ev('workflow_paused', { reasons: [] }),
    ), 'workflow')).rejects.toThrow(/paused/)
  })
})
