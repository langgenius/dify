import type { WorkflowDraftVariableResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { EditorResource } from '../../editor-resource/resource'
import type { VarInInspect } from '@/types/workflow'
import { consoleQuery } from '@/service/console'
import { createTestQueryClient } from '@/test/query-client'
import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { BlockEnum, VarType } from '../../types'
import useInspectVarsCrud from '../use-inspect-vars-crud'

const createInspectVar = (overrides: Partial<VarInInspect> = {}): VarInInspect => ({
  id: 'var-1',
  type: 'node',
  name: 'answer',
  description: 'Answer',
  selector: ['node-1', 'answer'],
  value_type: VarType.string,
  value: 'hello',
  edited: false,
  visible: true,
  is_truncated: false,
  full_content: {
    size_bytes: 5,
    download_url: 'https://example.com/answer.txt',
  },
  ...overrides,
})

const createDraftVariable = (
  overrides: Partial<WorkflowDraftVariableResponse> = {},
): WorkflowDraftVariableResponse => ({
  id: 'var-1',
  type: 'node',
  name: 'answer',
  description: 'Answer',
  selector: ['node-1', 'answer'],
  value_type: VarType.string,
  value: 'hello',
  edited: false,
  visible: true,
  is_truncated: false,
  full_content: null,
  ...overrides,
})

const conversationVars = [
  createDraftVariable({
    id: 'conversation-var',
    name: 'history',
    selector: ['conversation', 'history'],
  }),
]
const systemVars = [
  createDraftVariable({ id: 'query-var', name: 'query', selector: ['sys', 'query'] }),
  createDraftVariable({ id: 'files-var', name: 'files', selector: ['sys', 'files'] }),
  createDraftVariable({ id: 'time-var', name: 'time', selector: ['sys', 'time'] }),
]

// The draft variable list endpoints are app-scoped; seed them for the given app ID.
const seedAppVariables = (queryClient: ReturnType<typeof createTestQueryClient>, appId: string) => {
  const input = { input: { params: { app_id: appId } } }
  queryClient.setQueryData(
    consoleQuery.apps.byAppId.workflows.draft.conversationVariables.get.queryKey(input),
    { items: conversationVars },
  )
  queryClient.setQueryData(
    consoleQuery.apps.byAppId.workflows.draft.systemVariables.get.queryKey(input),
    { items: systemVars },
  )
}

describe('useInspectVarsCrud', () => {
  it('should read shared variable queries for the current app flow', () => {
    const queryClient = createTestQueryClient()
    seedAppVariables(queryClient, 'app-1')
    const { result } = renderWorkflowHook(() => useInspectVarsCrud(), {
      queryClient,
      resource: { kind: 'app' as const, appId: 'app-1', mode: 'workflow' as const },
    })

    expect(result.current.conversationVars.map((item) => item.id)).toEqual(['conversation-var'])
    expect(result.current.systemVars.map((item) => item.id)).toEqual(['time-var'])
  })

  it('should append query and files vars to the start node and keep other system vars separate', () => {
    const queryClient = createTestQueryClient()
    seedAppVariables(queryClient, 'flow-1')
    const { result } = renderWorkflowHook(() => useInspectVarsCrud(), {
      queryClient,
      initialStoreState: {
        nodesWithInspectVars: [
          {
            nodeId: 'start-node',
            nodePayload: {
              type: BlockEnum.Start,
              title: 'Start',
              desc: '',
            },
            nodeType: BlockEnum.Start,
            title: 'Start',
            vars: [
              createInspectVar({
                id: 'start-answer',
                selector: ['start-node', 'answer'],
              }),
            ],
          },
        ],
      },
      resource: { kind: 'app' as const, appId: 'flow-1', mode: 'workflow' as const },
    })

    expect(result.current.conversationVars).toHaveLength(1)
    expect(result.current.systemVars.map((item) => item.name)).toEqual(['time'])
    expect(result.current.nodesWithInspectVars[0]?.vars.map((item) => item.name)).toEqual([
      'answer',
      'query',
      'files',
    ])
  })

  it.each([
    { label: 'rag pipelines', resource: { kind: 'knowledge-pipeline', pipelineId: 'app-1' } },
    { label: 'snippets', resource: { kind: 'snippet', snippetId: 'app-1' } },
  ] satisfies { label: string; resource: EditorResource }[])(
    'should disable app-only variable queries in $label',
    ({ resource }) => {
      // Seed the app cache under the same ID to prove the resource ID is never read as an app ID.
      const queryClient = createTestQueryClient()
      seedAppVariables(queryClient, 'app-1')
      const { result } = renderWorkflowHook(() => useInspectVarsCrud(), { queryClient, resource })

      expect(result.current.conversationVars).toEqual([])
      expect(result.current.systemVars).toEqual([])
      expect(queryClient.isFetching()).toBe(0)
    },
  )
})
