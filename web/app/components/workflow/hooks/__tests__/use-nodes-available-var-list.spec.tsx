import type { ReactNode } from 'react'
import { useSnippetDraftStore } from '@/app/components/snippets/draft-store'
import { PipelineInputVarType } from '@/models/pipeline'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { CanvasNodesCatalogProbe } from '../../__tests__/canvas-nodes-catalog-probe'
import { createEdge, createNode } from '../../__tests__/fixtures'
import { renderWorkflowCanvasHook } from '../../__tests__/workflow-test-env'
import { BlockEnum, VarType } from '../../types'
import useNodesAvailableVarList, {
  useGetNodesAvailableVarList,
} from '../use-nodes-available-var-list'

const source = createNode({ id: 'source', data: { outputs: { answer: { type: VarType.string } } } })
const current = createNode({ id: 'current' })
const edges = [createEdge({ source: source.id, target: current.id })]

function options() {
  const { queryClient } = createConsoleQueryWrapper()
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  return { queryClient, nodes: [source, current], edges }
}

describe('useNodesAvailableVarList', () => {
  it('includes loop variables for the loop and its child while hiding environment and chat variables', () => {
    const loop = createNode({
      id: 'loop',
      data: {
        type: BlockEnum.Loop,
        loop_variables: [
          {
            id: 'counter',
            label: 'counter',
            var_type: VarType.number,
            value_type: 'constant',
            value: 0,
          },
        ],
      },
    })
    const child = createNode({ id: 'child', parentId: loop.id, data: { isInLoop: true } })
    const { result } = renderWorkflowCanvasHook(
      () =>
        useNodesAvailableVarList([loop, child], {
          filterVar: () => true,
          hideEnv: true,
          hideChatVar: true,
        }),
      {
        ...options(),
        nodes: [source, loop, child],
        edges: [createEdge({ source: source.id, target: loop.id })],
        resource: { kind: 'app', appId: 'app-1', mode: 'advanced-chat' },
        initialStoreState: {
          environmentVariables: [
            { id: 'env', name: 'secret', value: 'hidden', value_type: 'string', description: '' },
          ],
          conversationVariables: [
            { id: 'chat', name: 'history', value: '', value_type: VarType.string, description: '' },
          ],
        },
      },
    )
    for (const id of [loop.id, child.id]) {
      expect(result.current[id]!.availableNodes.map((node) => node.id)).toEqual(['source', 'loop'])
      const vars = result.current[id]!.availableVars
      expect(vars.find((group) => group.nodeId === 'source')?.vars).toEqual([
        expect.objectContaining({ variable: 'answer', type: VarType.string }),
      ])
      expect(vars.find((group) => group.nodeId === 'loop')?.vars).toEqual([
        expect.objectContaining({ variable: 'counter', type: VarType.number }),
      ])
      expect(vars.some((group) => group.nodeId === 'env' || group.nodeId === 'conversation')).toBe(
        false,
      )
    }
  })

  it('adds snippet input fields as virtual start variables on snippet canvases', () => {
    useSnippetDraftStore
      .getState()
      .setInputFields([
        { type: PipelineInputVarType.textInput, label: 'Topic', variable: 'topic', required: true },
      ])
    const { result } = renderWorkflowCanvasHook(() => useNodesAvailableVarList([current]), {
      ...options(),
      resource: { kind: 'snippet', snippetId: 'snippet-1' },
    })
    expect(result.current.current!.availableNodes.map((node) => node.id)).toEqual([
      'start',
      'source',
    ])
    expect(result.current.current!.availableVars[0]).toMatchObject({
      nodeId: 'start',
      isStartNode: true,
      vars: [{ variable: 'topic', type: VarType.string }],
    })
  })

  it('filters system variables on snippet canvases', () => {
    const { result } = renderWorkflowCanvasHook(() => useNodesAvailableVarList([current]), {
      ...options(),
      resource: { kind: 'snippet', snippetId: 'snippet-1' },
    })
    expect(result.current.current!.availableVars).toEqual([
      expect.objectContaining({
        nodeId: 'source',
        vars: [expect.objectContaining({ variable: 'answer', type: VarType.string })],
      }),
    ])
  })

  it('keeps system variables outside snippet canvases', () => {
    const { result } = renderWorkflowCanvasHook(() => useNodesAvailableVarList([current]), {
      ...options(),
      resource: { kind: 'app', appId: 'app-1', mode: 'advanced-chat' },
    })
    expect(
      result.current.current!.availableVars.find((group) => group.nodeId === 'global')?.vars,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ variable: 'sys.user_id' })]))
    expect(
      result.current.current!.availableVars.find((group) => group.nodeId === 'source')?.vars,
    ).toEqual([expect.objectContaining({ variable: 'answer' })])
  })

  it('returns leaf variables or caller-provided variables through the callback API', () => {
    const start = createNode({ id: 'start', data: { type: BlockEnum.Start, variables: [] } })
    const manual = createNode({
      id: 'manual',
      data: { outputs: { count: { type: VarType.number } } },
    })
    function Catalog({ children }: { children: ReactNode }) {
      return (
        <>
          <CanvasNodesCatalogProbe />
          {children}
        </>
      )
    }
    const { result } = renderWorkflowCanvasHook(() => useGetNodesAvailableVarList(), {
      ...options(),
      nodes: [start, source, current, manual],
      edges: [createEdge({ source: start.id, target: source.id }), ...edges],
      wrapper: Catalog,
    })
    const leaf = result.current.getNodesAvailableVarList([current], {
      onlyLeafNodeVar: true,
      filterVar: () => true,
    }).current!
    const supplied = result.current.getNodesAvailableVarList([current], {
      passedInAvailableNodes: [manual],
      filterVar: () => true,
    }).current!
    expect(leaf.availableNodes.map((node) => node.id)).toEqual(['source'])
    expect(leaf.availableVars.find((group) => group.nodeId === 'source')?.vars).toEqual([
      expect.objectContaining({ variable: 'answer' }),
    ])
    expect(supplied.availableNodes.map((node) => node.id)).toEqual(['manual'])
    expect(supplied.availableVars.find((group) => group.nodeId === 'manual')?.vars).toEqual([
      expect.objectContaining({ variable: 'count', type: VarType.number }),
    ])
  })

  it('keeps caller-provided nodes unchanged and isolates each loop availability list', () => {
    const first = createNode({ id: 'loop-a', data: { type: BlockEnum.Loop } })
    const second = createNode({ id: 'loop-b', data: { type: BlockEnum.Loop } })
    const passedInAvailableNodes = [source]
    const { result, rerender } = renderWorkflowCanvasHook(
      () => ({
        availability: useNodesAvailableVarList([first, second], {
          passedInAvailableNodes,
          filterVar: () => true,
        }),
        getAvailability: useGetNodesAvailableVarList().getNodesAvailableVarList,
      }),
      { ...options(), nodes: [source, first, second], edges: [] },
    )
    rerender()
    for (const availability of [
      result.current.availability,
      result.current.getAvailability([first, second], {
        passedInAvailableNodes,
        filterVar: () => true,
      }),
    ]) {
      expect(availability['loop-a']!.availableNodes.map((node) => node.id)).toEqual([
        'source',
        'loop-a',
      ])
      expect(availability['loop-b']!.availableNodes.map((node) => node.id)).toEqual([
        'source',
        'loop-b',
      ])
    }
    expect(passedInAvailableNodes).toEqual([source])
  })
})
