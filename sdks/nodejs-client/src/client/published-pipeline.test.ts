import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import type { PipelineRunRequest } from '../types/knowledge-base'
import { KnowledgeBaseClient } from './knowledge-base'

const request: PipelineRunRequest = {
  inputs: {},
  datasource_type: 'local_file',
  datasource_info_list: [{ upload_file_id: 'file-1' }],
  start_node_id: 'source',
  is_published: true,
  response_mode: 'streaming',
}

describe('pipeline response contracts', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each(['blocking', 'streaming'] as const)(
    'returns published batch metadata when response_mode is %s',
    async (responseMode) => {
      const batch = { batch: 'batch-1', dataset: { id: 'ds' }, documents: [{ id: 'doc-1' }] }
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(batch), {
        headers: { 'content-type': 'application/json' },
      }))
      vi.stubGlobal('fetch', fetchMock)
      const payload = { ...request, response_mode: responseMode }
      const result = await new KnowledgeBaseClient('test').runPipeline('ds', payload)

      expect(result.data).toEqual(batch)
      expect(result).not.toHaveProperty('toText')
      expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual(payload)
    },
  )

  it('keeps draft runs streaming', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(
      'data: {"event":"workflow_finished","data":{"status":"succeeded"}}\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    )))
    const result = await new KnowledgeBaseClient('test').runPipeline('ds', {
      ...request,
      is_published: false,
    })

    expect(Symbol.asyncIterator in result).toBe(true)
    if (!(Symbol.asyncIterator in result)) throw new Error('Expected a draft event stream')
    const events = []
    for await (const event of result) events.push(event.data)
    expect(events).toEqual([{ event: 'workflow_finished', data: { status: 'succeeded' } }])
  })
})
