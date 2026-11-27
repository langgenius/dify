import type { WorkflowRunOwner } from '../log'
import { fetchRunDetail, fetchTracingList } from '../log'

const request = vi.hoisted(() => vi.fn<() => Promise<Response>>())
vi.mock('@/service/base', () => ({ request }))

const owners: { owner: WorkflowRunOwner; path: string }[] = [
  { owner: { kind: 'app', appId: 'app-1' }, path: '/apps/app-1/workflow-runs/run-1' },
  {
    owner: { kind: 'knowledge-pipeline', pipelineId: 'pipeline-1' },
    path: '/rag/pipelines/pipeline-1/workflow-runs/run-1',
  },
  {
    owner: { kind: 'snippet', snippetId: 'snippet-1' },
    path: '/snippets/snippet-1/workflow-runs/run-1',
  },
]

beforeEach(() => {
  request.mockReset()
})

it.each(owners)('loads the $owner.kind run detail and node executions', async ({ owner, path }) => {
  request.mockImplementation(async () => Response.json({ id: 'run-1', data: [] }))

  await expect(fetchRunDetail(owner, 'run-1')).resolves.toEqual({
    id: 'run-1',
    data: [],
  })
  await expect(fetchTracingList(owner, 'run-1')).resolves.toEqual({
    id: 'run-1',
    data: [],
  })

  const [detailCall, tracingCall] = request.mock.calls as unknown as [string][]
  expect(new URL(detailCall![0], 'http://localhost').pathname).toMatch(new RegExp(`${path}$`))
  expect(new URL(tracingCall![0], 'http://localhost').pathname).toMatch(
    new RegExp(`${path}/node-executions$`),
  )
})
