import type { SnippetWorkflowResponse } from '@dify/contracts/api/console/snippets/types.gen'
import type { QueryClient } from '@tanstack/react-query'
import type { Edge, Node } from '../../../types'
import { act } from '@testing-library/react'
import { useStoreApi } from 'reactflow'
import { consoleQuery } from '@/service/console'
import { createTestQueryClient } from '@/test/query-client'
import { createEdge, createNode } from '../../../__tests__/fixtures'
import { renderWorkflowCanvasHook } from '../../../__tests__/workflow-test-env'
import { NESTED_ELEMENT_Z_INDEX } from '../../../constants'
import { useInsertSnippet } from '../use-insert-snippet'

const mockRequest = vi.hoisted(() => vi.fn())
const mockHandleSyncWorkflowDraft = vi.fn()
const mockSaveStateToHistory = vi.fn()
const mockToastError = vi.fn()
const mockIncrementSnippetUseCount = vi.fn()

vi.mock('@/service/base', () => ({
  request: (...args: unknown[]) => mockRequest(...args),
  sseGeneratorPost: vi.fn(),
}))

// History owns a debounced temporal store and is covered separately; insertion only emits its event.
vi.mock('../../../hooks/use-workflow-history', () => ({
  useWorkflowHistory: () => ({
    saveStateToHistory: mockSaveStateToHistory,
  }),
  WorkflowHistoryEvent: {
    NodePaste: 'NodePaste',
  },
}))

vi.mock('@/app/notifications', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

vi.mock('@/service/use-snippets', () => ({
  useIncrementSnippetUseCountMutation: () => ({
    mutate: mockIncrementSnippetUseCount,
  }),
}))

type PublishedWorkflow = Pick<SnippetWorkflowResponse, 'graph'>

const seedPublishedWorkflow = (queryClient: QueryClient, workflow: PublishedWorkflow) => {
  const queryOptions = consoleQuery.snippets.bySnippetId.workflows.publish.get.queryOptions({
    input: {
      params: { snippet_id: 'snippet-1' },
    },
  })

  queryClient.setQueryData<PublishedWorkflow>(queryOptions.queryKey, workflow)
}

describe('useInsertSnippet', () => {
  let queryClient: QueryClient
  const renderUseInsertSnippet = ({
    nodes = [createNode({ id: 'existing-node', selected: true, data: { selected: true } })],
    edges = [],
  }: { nodes?: Node[]; edges?: Edge[] } = {}) =>
    renderWorkflowCanvasHook(() => ({ ...useInsertSnippet(), reactFlowStore: useStoreApi() }), {
      queryClient,
      nodes,
      edges,
      hooksStoreProps: { doSyncWorkflowDraft: mockHandleSyncWorkflowDraft },
      initialStoreState: {
        debouncedSyncWorkflowDraft: (syncWorkflowDraft) => syncWorkflowDraft(),
      },
    })

  const getCanvas = (reactFlowStore: ReturnType<typeof useStoreApi>) => {
    const state = reactFlowStore.getState()
    return {
      nodes: state.getNodes(),
      edges: state.edges,
    }
  }

  beforeEach(() => {
    vi.resetAllMocks()
    queryClient = createTestQueryClient()
  })

  afterEach(() => {
    queryClient.clear()
  })

  describe('Insert Flow', () => {
    it('should keep prompt references parseable across insertions at the same timestamp', async () => {
      const timestamp = vi.spyOn(Date, 'now').mockReturnValue(1791619342702)
      try {
        seedPublishedWorkflow(queryClient, {
          graph: {
            nodes: [
              {
                id: 'extractor-with-hyphens',
                position: { x: 0, y: 0 },
                data: { type: 'document-extractor' },
              },
              {
                id: 'llm-with-hyphens',
                position: { x: 300, y: 0 },
                data: {
                  type: 'llm',
                  model: { mode: 'chat' },
                  prompt_template: [{ role: 'system', text: '{{#extractor-with-hyphens.text#}}' }],
                },
              },
            ],
            edges: [{ id: 'edge', source: 'extractor-with-hyphens', target: 'llm-with-hyphens' }],
          },
        })
        const { result } = renderUseInsertSnippet()

        for (let insertion = 0; insertion < 2; insertion++) {
          await act(async () => {
            await result.current.handleInsertSnippet('snippet-1')
          })
          const { nodes: nextNodes, edges } = getCanvas(result.current.reactFlowStore)
          const insertedNodes = nextNodes.slice(-2)
          const extractor = insertedNodes[0]!
          const llm = insertedNodes[1]!
          // Runtime variable selectors accept at most 50 alphanumeric/underscore characters.
          for (const node of insertedNodes) expect(node.id).toMatch(/^\w{1,50}$/)
          expect(llm.data.prompt_template).toEqual([
            { role: 'system', text: `{{#${extractor.id}.text#}}` },
          ])
          expect(new Set(nextNodes.map((node) => node.id)).size).toBe(nextNodes.length)
          expect(edges.at(-1)).toEqual(
            expect.objectContaining({ source: extractor.id, target: llm.id }),
          )
          expect(nextNodes).toHaveLength(3 + insertion * 2)
          expect(edges).toHaveLength(insertion + 1)
        }
      } finally {
        timestamp.mockRestore()
      }
    })

    it('should append remapped snippet graph into current workflow graph', async () => {
      seedPublishedWorkflow(queryClient, {
        graph: {
          nodes: [
            {
              id: 'snippet-node-1',
              zIndex: 1,
              position: { x: 10, y: 20 },
              data: {
                type: 'iteration',
                selected: false,
                _children: [{ nodeId: 'snippet-node-2', nodeType: 'code' }],
                start_node_id: 'snippet-node-2',
                iterator_selector: ['start', 'items'],
                output_selector: ['snippet-node-2', 'result'],
              },
            },
            {
              id: 'snippet-node-2',
              parentId: 'snippet-node-1',
              zIndex: 1002,
              position: { x: 30, y: 40 },
              data: {
                type: 'code',
                selected: false,
                iteration_id: 'snippet-node-1',
              },
            },
          ],
          edges: [
            {
              id: 'edge-1',
              source: 'snippet-node-1',
              sourceHandle: 'source',
              target: 'snippet-node-2',
              targetHandle: 'target',
              zIndex: 1002,
              data: {},
            },
          ],
        },
      })

      const { result } = renderUseInsertSnippet()

      await act(async () => {
        await result.current.handleInsertSnippet('snippet-1')
      })

      const { nodes: nextNodes, edges: nextEdges } = getCanvas(result.current.reactFlowStore)
      expect(nextNodes[0]!.selected).toBe(false)
      expect(nextNodes[0]!.data.selected).toBe(false)
      expect(nextNodes).toHaveLength(3)
      expect(nextNodes[1]!.id).not.toBe('snippet-node-1')
      expect(nextNodes[2]!.parentId).toBe(nextNodes[1]!.id)
      expect(nextNodes[1]!.zIndex).toBe(0)
      expect(nextNodes[2]!.zIndex).toBe(NESTED_ELEMENT_Z_INDEX)
      expect(nextNodes[1]!.data._children![0]!.nodeId).toBe(nextNodes[2]!.id)
      expect(nextNodes[1]!.data.start_node_id).toBe(nextNodes[2]!.id)
      expect(nextNodes[1]!.data.iterator_selector).toEqual(['start', 'items'])
      expect(nextNodes[1]!.data.output_selector).toEqual([nextNodes[2]!.id, 'result'])
      expect(nextNodes[2]!.data.iteration_id).toBe(nextNodes[1]!.id)

      expect(nextEdges).toHaveLength(1)
      expect(nextEdges[0]!.source).toBe(nextNodes[1]!.id)
      expect(nextEdges[0]!.target).toBe(nextNodes[2]!.id)
      expect(nextEdges[0]!.zIndex).toBe(NESTED_ELEMENT_Z_INDEX)

      expect(mockSaveStateToHistory).toHaveBeenCalledWith('NodePaste', {
        nodeId: nextNodes[1]!.id,
      })
      expect(mockHandleSyncWorkflowDraft).toHaveBeenCalledTimes(1)
      expect(mockIncrementSnippetUseCount).toHaveBeenCalledWith({
        params: { snippetId: 'snippet-1' },
      })
    })

    it('should remap variable selectors that reference nodes inside the snippet', async () => {
      seedPublishedWorkflow(queryClient, {
        graph: {
          nodes: [
            {
              id: 'snippet-llm',
              position: { x: 10, y: 20 },
              data: {
                type: 'llm',
                selected: false,
                model: { mode: 'chat' },
                prompt_template: [],
              },
            },
            {
              id: 'snippet-code',
              position: { x: 310, y: 20 },
              data: {
                type: 'code',
                selected: false,
                variables: [
                  { variable: 'arg1', value_selector: ['snippet-llm', 'text'] },
                  { variable: 'arg2', value_selector: ['snippet-llm', 'text'] },
                ],
              },
            },
          ],
          edges: [
            {
              id: 'snippet-llm-source-snippet-code-target',
              source: 'snippet-llm',
              sourceHandle: 'source',
              target: 'snippet-code',
              targetHandle: 'target',
              data: {},
            },
          ],
        },
      })

      const { result } = renderUseInsertSnippet()

      await act(async () => {
        await result.current.handleInsertSnippet('snippet-1')
      })

      const { nodes: nextNodes } = getCanvas(result.current.reactFlowStore)
      const insertedLLMNode = nextNodes.find((node) => node.data.type === 'llm')!
      const insertedCodeNode = nextNodes.find(
        (node) => node.id !== 'existing-node' && node.data.type === 'code',
      )!

      expect(insertedLLMNode.id).not.toBe('snippet-llm')
      expect(insertedCodeNode.data.variables).toEqual([
        { variable: 'arg1', value_selector: [insertedLLMNode.id, 'text'] },
        { variable: 'arg2', value_selector: [insertedLLMNode.id, 'text'] },
      ])
    })

    it('should remap current and legacy assigner selectors inside a loop snippet', async () => {
      seedPublishedWorkflow(queryClient, {
        graph: {
          nodes: [
            {
              id: 'snippet-loop',
              position: { x: 10, y: 20 },
              data: {
                type: 'loop',
                selected: false,
                _children: [
                  { nodeId: 'snippet-loop-start', nodeType: 'loop-start' },
                  { nodeId: 'snippet-code', nodeType: 'code' },
                  { nodeId: 'snippet-assigner-v2', nodeType: 'assigner' },
                  { nodeId: 'snippet-assigner-v1', nodeType: 'assigner' },
                ],
                start_node_id: 'snippet-loop-start',
              },
            },
            {
              id: 'snippet-loop-start',
              parentId: 'snippet-loop',
              position: { x: 30, y: 40 },
              data: {
                type: 'loop-start',
                selected: false,
                loop_id: 'snippet-loop',
              },
            },
            {
              id: 'snippet-code',
              parentId: 'snippet-loop',
              position: { x: 120, y: 40 },
              data: {
                type: 'code',
                selected: false,
                loop_id: 'snippet-loop',
                variables: [{ variable: 'current', value_selector: ['snippet-loop', 'current'] }],
              },
            },
            {
              id: 'snippet-assigner-v2',
              parentId: 'snippet-loop',
              position: { x: 360, y: 40 },
              data: {
                type: 'assigner',
                version: '2',
                selected: false,
                loop_id: 'snippet-loop',
                items: [
                  {
                    variable_selector: ['snippet-loop', 'steps'],
                    input_type: 'variable',
                    operation: 'append',
                    value: ['snippet-code', 'result'],
                  },
                  {
                    variable_selector: ['snippet-loop', 'current'],
                    input_type: 'constant',
                    operation: '-=',
                    value: 1,
                  },
                ],
              },
            },
            {
              id: 'snippet-assigner-v1',
              parentId: 'snippet-loop',
              position: { x: 600, y: 40 },
              data: {
                type: 'assigner',
                version: '1',
                selected: false,
                loop_id: 'snippet-loop',
                assigned_variable_selector: ['snippet-loop', 'legacy-target'],
                input_variable_selector: ['snippet-code', 'result'],
                write_mode: 'over-write',
              },
            },
          ],
          edges: [],
        },
      })

      const { result } = renderUseInsertSnippet()

      await act(async () => {
        await result.current.handleInsertSnippet('snippet-1')
      })

      const { nodes: nextNodes } = getCanvas(result.current.reactFlowStore)
      const insertedLoop = nextNodes.find((node) => node.data.type === 'loop')!
      const insertedCode = nextNodes.find(
        (node) => node.id !== 'existing-node' && node.data.type === 'code',
      )!
      const loopStart = nextNodes.find((node) => node.data.type === 'loop-start')!
      expect(insertedLoop.data.start_node_id).toBe(loopStart.id)
      expect(loopStart.data.loop_id).toBe(insertedLoop.id)
      expect(loopStart.parentId).toBe(insertedLoop.id)
      const insertedAssigners = nextNodes.filter((node) => node.data.type === 'assigner')
      const insertedV2Assigner = insertedAssigners.find((node) => node.data.items)!
      const insertedV1Assigner = insertedAssigners.find(
        (node) => node.data.assigned_variable_selector,
      )!

      expect(insertedCode.data.variables).toEqual([
        { variable: 'current', value_selector: [insertedLoop.id, 'current'] },
      ])
      expect(insertedV2Assigner.data.items).toEqual([
        {
          variable_selector: [insertedLoop.id, 'steps'],
          input_type: 'variable',
          operation: 'append',
          value: [insertedCode.id, 'result'],
        },
        {
          variable_selector: [insertedLoop.id, 'current'],
          input_type: 'constant',
          operation: '-=',
          value: 1,
        },
      ])
      expect(insertedV1Assigner.data.assigned_variable_selector).toEqual([
        insertedLoop.id,
        'legacy-target',
      ])
      expect(insertedV1Assigner.data.input_variable_selector).toEqual([insertedCode.id, 'result'])
    })

    it('should preserve external and constant selectors across independent repeated insertions', async () => {
      const sourceGraph = {
        nodes: [
          {
            id: 'snippet-source',
            position: { x: 10, y: 20 },
            data: {
              type: 'code',
              selected: false,
              variables: [{ variable: 'external', value_selector: ['env', 'api_key'] }],
            },
          },
          {
            id: 'snippet-assigner',
            position: { x: 310, y: 20 },
            data: {
              type: 'assigner',
              version: '2',
              selected: false,
              items: [
                {
                  variable_selector: ['conversation', 'latest'],
                  input_type: 'variable',
                  operation: 'over-write',
                  value: ['snippet-source', 'result'],
                },
                {
                  variable_selector: ['conversation', 'api_key'],
                  input_type: 'variable',
                  operation: 'over-write',
                  value: ['env', 'api_key'],
                },
                {
                  variable_selector: ['conversation', 'literal_selector'],
                  input_type: 'constant',
                  operation: 'set',
                  value: ['snippet-source', 'literal'],
                },
                {
                  variable_selector: ['conversation', 'count'],
                  input_type: 'constant',
                  operation: 'set',
                  value: 3,
                },
              ],
            },
          },
        ],
        edges: [],
      }
      const originalGraph = structuredClone(sourceGraph)
      seedPublishedWorkflow(queryClient, { graph: sourceGraph })
      const { result } = renderUseInsertSnippet()

      await act(async () => {
        await result.current.handleInsertSnippet('snippet-1')
      })

      const { nodes: firstInsertion } = getCanvas(result.current.reactFlowStore)
      const firstSource = firstInsertion.at(-2)!
      const firstAssigner = firstInsertion.at(-1)!

      await act(async () => {
        await result.current.handleInsertSnippet('snippet-1')
      })

      const { nodes: secondInsertion } = getCanvas(result.current.reactFlowStore)
      const secondSource = secondInsertion.at(-2)!
      const secondAssigner = secondInsertion.at(-1)!
      const firstAssignerAfterSecondInsert = secondInsertion.find(
        (node) => node.id === firstAssigner.id,
      )!

      expect(firstAssignerAfterSecondInsert.data.items![0]).toEqual(
        expect.objectContaining({
          variable_selector: ['conversation', 'latest'],
          value: [firstSource.id, 'result'],
        }),
      )
      expect(secondAssigner.data.items).toEqual([
        {
          variable_selector: ['conversation', 'latest'],
          input_type: 'variable',
          operation: 'over-write',
          value: [secondSource.id, 'result'],
        },
        {
          variable_selector: ['conversation', 'api_key'],
          input_type: 'variable',
          operation: 'over-write',
          value: ['env', 'api_key'],
        },
        {
          variable_selector: ['conversation', 'literal_selector'],
          input_type: 'constant',
          operation: 'set',
          value: ['snippet-source', 'literal'],
        },
        {
          variable_selector: ['conversation', 'count'],
          input_type: 'constant',
          operation: 'set',
          value: 3,
        },
      ])
      expect(secondSource.data.variables).toEqual([
        { variable: 'external', value_selector: ['env', 'api_key'] },
      ])
      expect(sourceGraph).toEqual(originalGraph)
    })

    it.each([
      { enabled: true, description: 'leaves routed outputs for the user to connect' },
      { enabled: false, description: 'automatically connects the ordinary Agent output' },
    ])('$description when inserting an Agent snippet into an edge', async ({ enabled }) => {
      const nodes = [
        createNode({ id: 'start', position: { x: 0, y: 0 }, data: { type: 'start' } }),
        createNode({ id: 'end', position: { x: 600, y: 0 }, data: { type: 'end' } }),
      ]
      const edges = [
        createEdge({
          id: 'start-source-end-target',
          source: 'start',
          sourceHandle: 'source',
          target: 'end',
          targetHandle: 'target',
        }),
      ]
      seedPublishedWorkflow(queryClient, {
        graph: {
          nodes: [
            {
              id: 'snippet-agent',
              position: { x: 0, y: 0 },
              data: {
                type: 'agent',
                agent_node_kind: 'dify_agent',
                version: '2',
                agent_output_routes: {
                  enabled,
                  routes: [
                    { id: 'accepted', name: 'Accepted', label: 'The request is accepted.' },
                    { id: 'rejected', name: 'Rejected', label: 'The request is rejected.' },
                  ],
                },
              },
            },
          ],
          edges: [],
        },
      })

      const { result } = renderUseInsertSnippet({ nodes, edges })

      await act(async () => {
        await result.current.handleInsertSnippet('snippet-1', {
          prevNodeId: 'start',
          prevNodeSourceHandle: 'source',
          nextNodeId: 'end',
          nextNodeTargetHandle: 'target',
        })
      })

      const { nodes: nextNodes, edges: nextEdges } = getCanvas(result.current.reactFlowStore)
      const insertedAgent = nextNodes.find((node) => node.data.type === 'agent')!
      const expectedEdges = [
        expect.objectContaining({
          source: 'start',
          sourceHandle: 'source',
          target: insertedAgent.id,
          targetHandle: 'target',
        }),
      ]
      if (!enabled) {
        expectedEdges.push(
          expect.objectContaining({
            source: insertedAgent.id,
            sourceHandle: 'source',
            target: 'end',
            targetHandle: 'target',
          }),
        )
      }
      expect(nextEdges).toEqual(expectedEdges)
    })

    it.each(['iteration', 'loop'] as const)(
      'should connect inserted snippet nodes inside the %s container',
      async (containerType) => {
        const nodes = [
          createNode({
            id: 'container-node',
            position: { x: 0, y: 0 },
            data: {
              type: containerType,
              selected: false,
              _children: [
                { nodeId: 'prev-node', nodeType: 'code' },
                { nodeId: 'next-node', nodeType: 'code' },
              ],
            },
          }),
          createNode({
            id: 'prev-node',
            parentId: 'container-node',
            position: { x: 0, y: 0 },
            width: 240,
            data: { type: 'code', selected: true, _connectedSourceHandleIds: ['source'] },
          }),
          createNode({
            id: 'next-node',
            parentId: 'container-node',
            position: { x: 300, y: 0 },
            data: { type: 'code', selected: false, _connectedTargetHandleIds: ['target'] },
          }),
        ]
        const edges = [
          createEdge({
            id: 'prev-node-source-next-node-target',
            source: 'prev-node',
            sourceHandle: 'source',
            target: 'next-node',
            targetHandle: 'target',
            data: {
              sourceType: 'code',
              targetType: 'code',
            },
          }),
        ]
        seedPublishedWorkflow(queryClient, {
          graph: {
            nodes: [
              {
                id: 'snippet-entry',
                position: { x: 0, y: 0 },
                data: {
                  type: 'llm',
                  selected: false,
                  model: { mode: 'chat' },
                  prompt_template: [],
                },
              },
              {
                id: 'snippet-exit',
                position: { x: 300, y: 0 },
                data: { type: 'code', selected: false },
              },
            ],
            edges: [
              {
                id: 'snippet-entry-source-snippet-exit-target',
                source: 'snippet-entry',
                sourceHandle: 'source',
                target: 'snippet-exit',
                targetHandle: 'target',
                data: {
                  sourceType: 'llm',
                  targetType: 'code',
                },
              },
            ],
          },
        })

        const { result } = renderUseInsertSnippet({ nodes, edges })

        await act(async () => {
          await result.current.handleInsertSnippet('snippet-1', {
            prevNodeId: 'prev-node',
            prevNodeSourceHandle: 'source',
            nextNodeId: 'next-node',
            nextNodeTargetHandle: 'target',
          })
        })

        const { nodes: nextNodes, edges: nextEdges } = getCanvas(result.current.reactFlowStore)
        const insertedEntry = nextNodes.find(
          (node) => node.id !== 'prev-node' && node.id !== 'next-node' && node.data.type === 'llm',
        )!
        const insertedExit = nextNodes.find(
          (node) => node.id !== 'prev-node' && node.id !== 'next-node' && node.data.type === 'code',
        )!
        const shiftedNextNode = nextNodes.find((node) => node.id === 'next-node')!
        expect(insertedEntry.position).toEqual({ x: 300, y: 0 })
        expect(insertedEntry.parentId).toBe('container-node')
        expect(insertedExit.parentId).toBe('container-node')
        expect(shiftedNextNode.position.x).toBe(600)
        expect(
          nextNodes.find((node) => node.id === 'prev-node')!.data._connectedSourceHandleIds,
        ).toEqual(['source'])
        expect(insertedEntry.data._connectedTargetHandleIds).toEqual(['target'])
        expect(insertedExit.data._connectedSourceHandleIds).toEqual(['source'])
        expect(shiftedNextNode.data._connectedTargetHandleIds).toEqual(['target'])

        expect(nextEdges).toHaveLength(3)
        expect(nextEdges.some((edge) => edge.id === 'prev-node-source-next-node-target')).toBe(
          false,
        )
        expect(nextEdges).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              source: 'prev-node',
              sourceHandle: 'source',
              target: insertedEntry.id,
              targetHandle: 'target',
            }),
            expect.objectContaining({
              source: insertedEntry.id,
              target: insertedExit.id,
            }),
            expect.objectContaining({
              source: insertedExit.id,
              sourceHandle: 'source',
              target: 'next-node',
              targetHandle: 'target',
            }),
          ]),
        )
        const incomingEdge = nextEdges.find(
          (edge) => edge.source === 'prev-node' && edge.target === insertedEntry.id,
        )
        const insertedInternalEdge = nextEdges.find(
          (edge) => edge.source === insertedEntry.id && edge.target === insertedExit.id,
        )
        const outgoingEdge = nextEdges.find(
          (edge) => edge.source === insertedExit.id && edge.target === 'next-node',
        )
        expect(incomingEdge?.zIndex).toBe(NESTED_ELEMENT_Z_INDEX)
        expect(insertedInternalEdge?.zIndex).toBe(NESTED_ELEMENT_Z_INDEX)
        expect(outgoingEdge?.zIndex).toBe(NESTED_ELEMENT_Z_INDEX)
        expect(insertedInternalEdge?.data).toEqual(
          expect.objectContaining({
            isInIteration: containerType === 'iteration',
            iteration_id: containerType === 'iteration' ? 'container-node' : undefined,
            isInLoop: containerType === 'loop',
            loop_id: containerType === 'loop' ? 'container-node' : undefined,
          }),
        )
        expect(mockIncrementSnippetUseCount).toHaveBeenCalledWith({
          params: { snippetId: 'snippet-1' },
        })
      },
    )

    it('should show error toast when fetching snippet workflow fails', async () => {
      mockRequest.mockRejectedValue(new Error('insert failed'))
      const initialNodes = [
        createNode({ id: 'existing-node', data: { selected: true } }),
        createNode({ id: 'other-node' }),
      ]
      const initialEdges = [
        createEdge({ id: 'existing-edge', source: 'existing-node', target: 'other-node' }),
      ]

      const { result } = renderUseInsertSnippet({ nodes: initialNodes, edges: initialEdges })
      const before = getCanvas(result.current.reactFlowStore)

      await act(async () => {
        await result.current.handleInsertSnippet('snippet-1')
      })

      expect(mockToastError).toHaveBeenCalledWith('insert failed')
      expect(getCanvas(result.current.reactFlowStore)).toEqual(before)
      expect(mockSaveStateToHistory).not.toHaveBeenCalled()
      expect(mockHandleSyncWorkflowDraft).not.toHaveBeenCalled()
      expect(mockIncrementSnippetUseCount).not.toHaveBeenCalled()
    })
  })
})
