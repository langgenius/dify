import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowCanvasHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import useAvailableVarList from '../use-available-var-list'

function renderVariables(kind: 'snippet' | 'app') {
  const { queryClient } = createConsoleQueryWrapper()
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  return renderWorkflowCanvasHook(() => useAvailableVarList('consumer'), {
    queryClient,
    resource:
      kind === 'snippet'
        ? { kind, snippetId: 'snippet-1' }
        : { kind, appId: 'app-1', mode: 'advanced-chat' },
    nodes: [
      createNode({
        id: 'source',
        data: {
          type: BlockEnum.Code,
          title: 'Answer',
          outputs: { answer: { type: VarType.string, children: null } },
        },
      }),
      createNode({ id: 'consumer' }),
    ],
    edges: [createEdge({ source: 'source', target: 'consumer' })],
  })
}

describe('useAvailableVarList', () => {
  it('keeps upstream outputs while excluding system variables on snippet canvases', () => {
    const { result } = renderVariables('snippet')

    expect(result.current.availableVars).toEqual([
      expect.objectContaining({
        nodeId: 'source',
        vars: [expect.objectContaining({ variable: 'answer', type: VarType.string })],
      }),
    ])
  })

  it('keeps upstream outputs and system variables on chatflow canvases', () => {
    const { result } = renderVariables('app')

    expect(result.current.availableVars).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: 'source',
          vars: [expect.objectContaining({ variable: 'answer', type: VarType.string })],
        }),
        expect.objectContaining({
          nodeId: 'global',
          vars: expect.arrayContaining([
            expect.objectContaining({ variable: 'sys.user_id', type: VarType.string }),
          ]),
        }),
      ]),
    )
  })
})
