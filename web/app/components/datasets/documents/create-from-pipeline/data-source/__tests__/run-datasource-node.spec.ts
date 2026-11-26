import type { DatasourceNodeRunPayload } from '@dify/contracts/api/console/rag/types.gen'
import { runDatasourceNode } from '../run-datasource-node'

vi.mock('@/utils/client', () => ({ isClient: true, isServer: false }))

const eventStream = (...frames: Record<string, unknown>[]) =>
  new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  })

const fetchMock = vi.fn<typeof fetch>()

const fetchedRequest = async () => {
  const [input, init] = fetchMock.mock.lastCall!
  const request = input instanceof Request ? input : new Request(input, init)
  return {
    method: request.method,
    path: new URL(request.url).pathname,
    body: JSON.parse(await request.clone().text()),
  }
}

const body: DatasourceNodeRunPayload = {
  inputs: { url: 'https://example.com' },
  datasource_type: 'website_crawl',
  credential_id: 'credential-1',
}

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () =>
    eventStream({ event: 'datasource_completed', data: [], time_consuming: 1 }),
  )
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

it.each([
  [true, 'draft'],
  [false, 'published'],
])('runs the node of the isInPipeline=%s workflow on the %s route', async (isInPipeline, route) => {
  const onDataSourceNodeCompleted = vi.fn()
  runDatasourceNode({ pipelineId: 'pipeline-1', nodeId: 'node-1', isInPipeline }, body, {
    onDataSourceNodeCompleted,
  })

  await vi.waitFor(() =>
    expect(onDataSourceNodeCompleted).toHaveBeenCalledExactlyOnceWith({
      event: 'datasource_completed',
      data: [],
      time_consuming: 1,
    }),
  )
  const request = await fetchedRequest()
  expect(request.method).toBe('POST')
  expect(request.path).toMatch(
    new RegExp(`/rag/pipelines/pipeline-1/workflows/${route}/datasource/nodes/node-1/run$`),
  )
  expect(request.body).toEqual(body)
})

it('keeps fields the payload type does not declare', async () => {
  runDatasourceNode(
    { pipelineId: 'pipeline-1', nodeId: 'node-1', isInPipeline: false },
    { ...body, response_mode: 'streaming' } as DatasourceNodeRunPayload,
    {},
  )

  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
  expect((await fetchedRequest()).body).toEqual({ ...body, response_mode: 'streaming' })
})

it('still sends the run before the pipeline id is known', async () => {
  runDatasourceNode({ pipelineId: undefined, nodeId: 'node-1', isInPipeline: false }, body, {})

  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
  expect((await fetchedRequest()).path).toMatch(
    /\/rag\/pipelines\/undefined\/workflows\/published\/datasource\/nodes\/node-1\/run$/,
  )
})
