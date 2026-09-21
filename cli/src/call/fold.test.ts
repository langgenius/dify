import { expect, it } from 'vite-plus/test'
import { exitCodeFor, finishFold, foldEvent, newFoldResult } from './fold'

function run(events: [string, Record<string, unknown>][]) {
  const r = newFoldResult()
  for (const [n, e] of events) foldEvent(r, n, e)
  return { result: finishFold(r), code: exitCodeFor(r) }
}

it('folds a chat run and copies the reply hint from message_end', () => {
  const hint = {
    summary: 'Reply in this conversation',
    op: 'console_app.chat.run',
    input: { app_id: 'a', conversation_id: 'c1', query: null, inputs: {} },
  }
  const { result, code } = run([
    ['message', { answer: 'a' }],
    ['message', { answer: 'b' }],
    ['message_end', { message_id: 'm1', conversation_id: 'c1', hints: [hint] }],
  ])
  expect(result).toEqual({
    status: 'ended',
    text: { answer: 'ab' },
    message_id: 'm1',
    conversation_id: 'c1',
    hints: [hint],
  })
  expect(code).toBe(0)
})

it('folds a failed workflow without an error event', () => {
  const { result, code } = run([
    [
      'workflow_finished',
      { data: { status: 'failed', outputs: {}, total_tokens: 0, error: 'inputs.q is required' } },
    ],
  ])
  expect(result.status).toBe('failed')
  expect(result.error).toEqual({ message: 'inputs.q is required' })
  expect(code).toBe(1)
})

it('keeps text_chunk previews only when incomplete', () => {
  const incomplete = run([
    ['text_chunk', { data: { text: 'so far', from_variable_selector: ['llm_1', 'text'] } }],
  ])
  expect(incomplete.result).toEqual({
    status: 'incomplete',
    text: { answer: '', by_source: { 'llm_1.text': 'so far' } },
    hints: [],
  })
  const ended = run([
    ['text_chunk', { data: { text: 'x', from_variable_selector: ['n', 't'] } }],
    ['workflow_finished', { data: { status: 'succeeded', outputs: { r: 1 } } }],
  ])
  expect(ended.result.text).toEqual({ answer: '' })
  expect(ended.result.outputs).toEqual({ r: 1 })
})

it('a late error still wins and unknown events are ignored', () => {
  expect(
    run([
      ['message_end', {}],
      ['error', { message: 'late', code: 'x' }],
    ]).result.status,
  ).toBe('failed')
  expect(run([['node_started', { id: 'n1' }]]).result.status).toBe('incomplete')
})

it('copies server hints from a pause and suspends; a pause without hints is still suspended', () => {
  const hint = {
    summary: 'Submit',
    op: 'run.form.submit',
    input: { app_id: 'a', form_token: 'ft', action: 'submit', inputs: { name: null } },
    form: [{ output_variable_name: 'name' }],
  }
  const paused = run([
    ['message', { answer: 'x' }],
    [
      'human_input_required',
      { data: { form_token: 'ft', actions: [{ id: 'submit' }] }, hints: [hint] },
    ],
  ])
  expect(paused.result).toEqual({ status: 'suspended', text: { answer: 'x' }, hints: [hint] })
  expect(paused.code).toBe(0)
  const bare = run([
    [
      'human_input_required',
      { data: { form_token: 'ft', actions: [], approval_channels: ['email'] } },
    ],
  ])
  expect(bare.result).toEqual({ status: 'suspended', text: { answer: '' }, hints: [] })
})
