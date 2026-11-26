import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { APIError, ValidationError } from '../errors/dify-error'
import { ChatClient } from './chat'
import { WorkflowClient } from './workflow'

describe('paused workflow human input', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each([['ChatClient', ChatClient], ['WorkflowClient', WorkflowClient]] as const)('reads, submits and follows a form through %s', async (_, Client) => {
    const form = {
      form_content: 'Approve this result?',
      inputs: [{ output_variable_name: 'comment', type: 'paragraph', default: null }],
      resolved_default_values: { comment: 'Looks good' },
      user_actions: [{ id: 'approve', title: 'Approve', button_style: 'primary' }],
      expiration_time: 1800000000,
    }
    const requests: Request[] = []
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      const request = new Request(url, init)
      requests.push(request)
      if (new URL(request.url).pathname.endsWith('/events')) {
        return new Response('data: {"event":"workflow_finished","data":{"status":"succeeded"}}\n\n', {
          headers: { 'content-type': 'text/event-stream' },
        })
      }
      return new Response(JSON.stringify(request.method === 'GET' ? form : {}), {
        headers: { 'content-type': 'application/json' },
      })
    }))
    const client = new Client('test-key')
    expect((await client.getHumanInputForm('form-token')).data).toEqual(form)
    const submission = Object.freeze({ action: 'approve', inputs: { comment: 'Approved' }, user: 'user + 1' })
    expect((await client.submitHumanInputForm('form-token', submission)).data).toEqual({})
    const stream = await client.getWorkflowEvents('run-1', 'user + 1', {
      includeStateSnapshot: true,
      continueOnPause: false,
    })
    const events = []
    for await (const event of stream) events.push(event.data)
    expect(events).toEqual([{ event: 'workflow_finished', data: { status: 'succeeded' } }])
    expect(requests.map(request => [request.method, new URL(request.url).pathname])).toEqual([
      ['GET', '/v1/form/human_input/form-token'],
      ['POST', '/v1/form/human_input/form-token'],
      ['GET', '/v1/workflow/run-1/events'],
    ])
    expect(await requests[1]!.json()).toEqual(submission)
    expect(Object.fromEntries(new URL(requests[2]!.url).searchParams)).toEqual({
      user: 'user + 1', include_state_snapshot: 'true', continue_on_pause: 'false',
    })
    expect(requests.every(request => request.headers.get('authorization') === 'Bearer test-key')).toBe(true)
  })

  it('preserves expired form errors', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      code: 'human_input_form_expired', message: 'Form expired',
    }), { status: 412, headers: { 'content-type': 'application/json' } })))
    await expect(new WorkflowClient('test').getHumanInputForm('expired')).rejects.toBeInstanceOf(APIError)
  })

  it('submits approval-only forms and reconnects with the API defaults', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}'))
      .mockResolvedValueOnce(new Response('data: {"event":"workflow_finished"}\n\n'))
    vi.stubGlobal('fetch', fetchMock)
    const client = new WorkflowClient('test')
    await client.submitHumanInputForm('form', { action: 'approve', inputs: {}, user: 'u' })
    const stream = await client.getWorkflowEvents('run', 'u')
    for await (const _ of stream) { /* Drain the returned response. */ }

    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({ action: 'approve', inputs: {}, user: 'u' })
    expect(new URL(fetchMock.mock.calls[1]![0] as string).search).toBe('?user=u')
  })

  it('rejects missing form, action, and user identifiers before sending', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const client = new WorkflowClient('test')
    expect(() => client.getHumanInputForm('')).toThrow(ValidationError)
    expect(() => client.submitHumanInputForm('form', { action: '', inputs: {}, user: 'u' })).toThrow(ValidationError)
    expect(() => client.getWorkflowEvents('run', '')).toThrow(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
