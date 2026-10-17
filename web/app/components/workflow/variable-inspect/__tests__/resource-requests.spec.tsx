import type {
  WorkflowDraftVariableResponse,
  WorkflowDraftVariableWithoutValueResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { EditorResource } from '../../editor-resource/resource'
import { act, renderHook, waitFor } from '@testing-library/react'
import { consoleQuery } from '@/service/console'
import {
  useConversationVarValues,
  useDeleteAllInspectorVars,
  useDeleteInspectVar,
  useDeleteNodeInspectorVars,
  useEditInspectorVar,
  useInvalidateAllLastRun,
  useInvalidateConversationVarValues,
  useInvalidateLastRun,
  useInvalidateSysVarValues,
  useResetInspectorVar,
  useSysVarValues,
} from '@/service/use-workflow'
import { fetchAllInspectVars, fetchNodeInspectVars } from '@/service/workflow'
import { routeFetchTo } from '@/test/console/fetch'
import { createQueryClientWrapper } from '@/test/console/query-client'
import { createTestQueryClient } from '@/test/query-client'

const request = vi.hoisted(() =>
  vi.fn<
    (url: string, init: RequestInit | undefined, options: { request: Request }) => Promise<Response>
  >(),
)
routeFetchTo(request)

const summary: WorkflowDraftVariableWithoutValueResponse = {
  id: 'variable-1',
  type: 'node',
  name: 'answer',
  description: '',
  selector: ['node-1', 'answer'],
  value_type: 'string',
  edited: false,
  visible: true,
  is_truncated: false,
}
const variable: WorkflowDraftVariableResponse = { ...summary, value: 'result', full_content: null }
const hosts: { resource: EditorResource; prefix: string }[] = [
  { resource: { kind: 'app', appId: 'workflow-1', mode: 'workflow' }, prefix: '/apps/workflow-1' },
  {
    resource: { kind: 'app', appId: 'chatflow-1', mode: 'advanced-chat' },
    prefix: '/apps/chatflow-1',
  },
  {
    resource: { kind: 'knowledge-pipeline', pipelineId: 'pipeline-1' },
    prefix: '/rag/pipelines/pipeline-1',
  },
  { resource: { kind: 'snippet', snippetId: 'snippet-1' }, prefix: '/snippets/snippet-1' },
]

beforeEach(() => {
  request.mockReset()
})

describe.each(hosts)('inspector requests for $prefix', ({ resource, prefix }) => {
  it('loads every summary page, then loads values for the selected node through the same resource', async () => {
    request.mockImplementation(async (url) => {
      const path = new URL(url)
      if (path.pathname.endsWith('/nodes/node-1/variables'))
        return Response.json({ items: [variable] })
      return Response.json({
        total: 101,
        items:
          path.searchParams.get('page') === '1'
            ? Array.from({ length: 100 }, (_, index) => ({ ...summary, id: `variable-${index}` }))
            : [{ ...summary, id: 'variable-last' }],
      })
    })
    const summaries = await fetchAllInspectVars(resource)
    expect(summaries).toHaveLength(101)
    expect(summaries[0]).not.toHaveProperty('value')
    expect(await fetchNodeInspectVars(resource, 'node-1')).toEqual([variable])
    expect(request.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      `/console/api${prefix}/workflows/draft/variables`,
      `/console/api${prefix}/workflows/draft/variables`,
      `/console/api${prefix}/workflows/draft/nodes/node-1/variables`,
    ])
  })

  it('routes edits, reset and deletions without treating another resource ID as an app ID', async () => {
    request.mockImplementation(async (_url, _init, { request }) =>
      request.method === 'DELETE' || request.method === 'PUT'
        ? new Response(null, { status: 204 })
        : Response.json(variable),
    )
    const client = createTestQueryClient()
    const { result } = renderHook(
      () => ({
        edit: useEditInspectorVar(resource),
        reset: useResetInspectorVar(resource),
        remove: useDeleteInspectVar(resource),
        removeNode: useDeleteNodeInspectorVars(resource),
        removeAll: useDeleteAllInspectorVars(resource),
      }),
      { wrapper: createQueryClientWrapper(client) },
    )
    await act(async () => {
      await result.current.edit.mutateAsync({ varId: 'variable-1', value: 'changed' })
      await result.current.reset.mutateAsync('variable-1')
      await result.current.remove.mutateAsync('variable-1')
      await result.current.removeNode.mutateAsync('node-1')
      await result.current.removeAll.mutateAsync()
    })
    const requests = request.mock.calls.map(([, , options]) => options.request)
    expect(requests.map((request) => request.method)).toEqual([
      'PATCH',
      'PUT',
      'DELETE',
      'DELETE',
      'DELETE',
    ])
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      `/console/api${prefix}/workflows/draft/variables/variable-1`,
      `/console/api${prefix}/workflows/draft/variables/variable-1/reset`,
      `/console/api${prefix}/workflows/draft/variables/variable-1`,
      `/console/api${prefix}/workflows/draft/nodes/node-1/variables`,
      `/console/api${prefix}/workflows/draft/variables`,
    ])
    expect(await requests[0]!.json()).toEqual({ value: 'changed' })
  })
})

it('invalidates only the current app variable queries and leaves other editors cached', async () => {
  request.mockResolvedValue(Response.json({ items: [variable] }))
  const client = createTestQueryClient()
  const current: EditorResource = { kind: 'app', appId: 'app-1', mode: 'advanced-chat' }
  const input = (appId: string) => ({ input: { params: { app_id: appId } } })
  const conversation = consoleQuery.apps.byAppId.workflows.draft.conversationVariables.get
  const system = consoleQuery.apps.byAppId.workflows.draft.systemVariables.get
  for (const appId of ['app-1', 'app-2']) {
    client.setQueryData(conversation.queryKey(input(appId)), { items: [] })
    client.setQueryData(system.queryKey(input(appId)), { items: [] })
  }
  const { result } = renderHook(
    () => ({
      conversation: useInvalidateConversationVarValues(current),
      system: useInvalidateSysVarValues(current),
    }),
    { wrapper: createQueryClientWrapper(client) },
  )
  await act(async () => {
    await result.current.conversation()
    await result.current.system()
  })
  expect(client.getQueryState(conversation.queryKey(input('app-1')))?.isInvalidated).toBe(true)
  expect(client.getQueryState(system.queryKey(input('app-1')))?.isInvalidated).toBe(true)
  expect(client.getQueryState(conversation.queryKey(input('app-2')))?.isInvalidated).toBe(false)
  expect(client.getQueryState(system.queryKey(input('app-2')))?.isInvalidated).toBe(false)
  expect(request).not.toHaveBeenCalled()
})

it.each(hosts.filter(({ resource }) => resource.kind !== 'app'))(
  'does not request app-only variables for $prefix',
  async ({ resource }) => {
    const { result } = renderHook(
      () => ({
        conversation: useConversationVarValues(resource),
        system: useSysVarValues(resource),
      }),
      { wrapper: createQueryClientWrapper(createTestQueryClient()) },
    )
    await waitFor(() => expect(result.current.conversation.fetchStatus).toBe('idle'))
    expect(result.current.system.fetchStatus).toBe('idle')
    expect(request).not.toHaveBeenCalled()
  },
)

const lastRunTargets = [
  {
    resource: { kind: 'app', appId: 'shared-id', mode: 'workflow' },
    keyForNode: (nodeId: string) =>
      consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.lastRun.get.queryKey({
        input: { params: { app_id: 'shared-id', node_id: nodeId } },
      }),
  },
  {
    resource: { kind: 'knowledge-pipeline', pipelineId: 'shared-id' },
    keyForNode: (nodeId: string) =>
      consoleQuery.rag.pipelines.byPipelineId.workflows.draft.nodes.byNodeId.lastRun.get.queryKey({
        input: { params: { pipeline_id: 'shared-id', node_id: nodeId } },
      }),
  },
  {
    resource: { kind: 'snippet', snippetId: 'shared-id' },
    keyForNode: (nodeId: string) =>
      consoleQuery.snippets.bySnippetId.workflows.draft.nodes.byNodeId.lastRun.get.queryKey({
        input: { params: { snippet_id: 'shared-id', node_id: nodeId } },
      }),
  },
  {
    resource: { kind: 'app', appId: 'other-app', mode: 'advanced-chat' },
    keyForNode: (nodeId: string) =>
      consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.lastRun.get.queryKey({
        input: { params: { app_id: 'other-app', node_id: nodeId } },
      }),
  },
] satisfies { resource: EditorResource; keyForNode: (nodeId: string) => readonly unknown[] }[]

it.each(lastRunTargets)(
  'isolates node and whole-resource last-run invalidation for $resource',
  async (target) => {
    const client = createTestQueryClient()
    const cachedRuns = lastRunTargets.flatMap((entry) =>
      ['node-1', 'node-2'].map((nodeId) => ({
        target: entry,
        nodeId,
        queryKey: entry.keyForNode(nodeId),
      })),
    )
    for (const { queryKey, nodeId } of cachedRuns)
      client.setQueryData(queryKey, { id: `run-${nodeId}`, node_id: nodeId, status: 'succeeded' })

    const { result } = renderHook(
      () => ({
        invalidateNode: useInvalidateLastRun(target.resource, 'node-1'),
        invalidateResource: useInvalidateAllLastRun(target.resource),
      }),
      { wrapper: createQueryClientWrapper(client) },
    )

    await act(async () => {
      await result.current.invalidateNode()
    })
    for (const entry of cachedRuns)
      expect(client.getQueryState(entry.queryKey)?.isInvalidated).toBe(
        entry.target === target && entry.nodeId === 'node-1',
      )

    await act(async () => {
      await result.current.invalidateResource()
    })
    for (const entry of cachedRuns)
      expect(client.getQueryState(entry.queryKey)?.isInvalidated).toBe(entry.target === target)

    expect(request).not.toHaveBeenCalled()
  },
)
