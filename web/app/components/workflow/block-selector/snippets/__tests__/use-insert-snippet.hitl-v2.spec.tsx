import type { SnippetWorkflowResponse } from '@dify/contracts/api/console/snippets/types.gen'
import type { Node } from '../../../types'
import { act } from '@testing-library/react'
import { useStoreApi } from 'reactflow'
import { consoleQuery } from '@/service/console'
import { createTestQueryClient } from '@/test/query-client'
import { createNode } from '../../../__tests__/fixtures'
import { renderWorkflowCanvasHook } from '../../../__tests__/workflow-test-env'
import HumanInputV2Default from '../../../nodes/human-input-v2/default'
import HumanInputDefault from '../../../nodes/human-input/default'
import { BlockEnum } from '../../../types'
import { useInsertSnippet } from '../use-insert-snippet'

const releaseGate = vi.hoisted(() => ({ enabled: true }))
vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  get ENABLE_HITL_IM() {
    return releaseGate.enabled
  },
}))

// Usage accounting is a service boundary; graph insertion and its stores stay real.
vi.mock('@/service/use-snippets', () => ({
  useIncrementSnippetUseCountMutation: () => ({ mutate: vi.fn() }),
}))

const approval = (id: string, version?: '2') =>
  createNode({
    id,
    data: {
      ...(version ? HumanInputV2Default : HumanInputDefault).defaultValue,
      type: BlockEnum.HumanInput,
      title: 'Approval',
    },
  })
function setup(nodes: Node[], insertedNode: Node) {
  const queryClient = createTestQueryClient()
  queryClient.setQueryData<Pick<SnippetWorkflowResponse, 'graph'>>(
    consoleQuery.snippets.bySnippetId.workflows.publish.get.queryKey({
      input: { params: { snippet_id: 'snippet-1' } },
    }),
    { graph: { nodes: [insertedNode], edges: [] } },
  )
  return renderWorkflowCanvasHook(
    () => ({
      ...useInsertSnippet(),
      canvas: useStoreApi(),
    }),
    {
      nodes,
      edges: [],
      queryClient,
      historyStore: { nodes, edges: [] },
      hooksStoreProps: { doSyncWorkflowDraft: async () => null },
    },
  )
}

beforeEach(() => {
  releaseGate.enabled = true
  vi.useFakeTimers()
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

it.each([undefined, '2'] as const)(
  'allows only legacy snippet approvals (version %s) when the release gate is off',
  async (version) => {
    releaseGate.enabled = false
    const existing = version ? createNode({ id: 'existing-code' }) : approval('existing-legacy')
    const inserted = approval('snippet-approval', version)
    const { result } = setup([existing], inserted)
    const before = result.current.canvas.getState().getNodes()

    await act(async () => result.current.handleInsertSnippet('snippet-1'))

    const nodes = result.current.canvas.getState().getNodes()
    if (version) {
      expect(nodes).toEqual(before)
    } else {
      expect(nodes).toHaveLength(2)
      expect(nodes[0]).toMatchObject({ id: existing.id, data: existing.data })
      expect(nodes[1]?.id).not.toBe(inserted.id)
      expect(nodes[1]?.data).toMatchObject(inserted.data)
    }
    expect(result.current.canvas.getState().edges).toEqual([])
  },
)

it('preserves the graph when a legacy draft blocks a Human Input v2 snippet', async () => {
  const { result } = setup([approval('legacy-human-input')], approval('snippet-human-input', '2'))
  const before = result.current.canvas.getState().getNodes()

  let inserted: boolean | undefined
  await act(async () => {
    inserted = await result.current.handleInsertSnippet('snippet-1')
    await vi.advanceTimersByTimeAsync(600)
  })

  expect(inserted).toBe(false)
  expect(result.current.canvas.getState().getNodes()).toEqual(before)
  expect(result.current.canvas.getState().edges).toEqual([])
})
