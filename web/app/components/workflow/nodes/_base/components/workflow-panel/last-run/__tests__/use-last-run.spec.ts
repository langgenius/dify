import type { SyncDraftCallback } from '@/app/components/workflow/hooks-store'
import type { IterationNodeType } from '@/app/components/workflow/nodes/iteration/types'
import type { ListFilterNodeType } from '@/app/components/workflow/nodes/list-operator/types'
import type { Node } from '@/app/components/workflow/types'
import type { ExternalAgentWorkflowPreviewNodeData } from '@/features/agent-v2/external-agent/workflow-preview/types'
import { act } from '@testing-library/react'
import { useStoreApi } from 'reactflow'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowCanvasHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import {
  BlockEnum,
  ErrorHandleMode,
  NodeRunningStatus,
  VarType,
} from '@/app/components/workflow/types'
import useLastRun from '../use-last-run'

const request = vi.hoisted(() => vi.fn())
const externalRun = vi.hoisted(() =>
  vi.fn<
    typeof import('@/service/console').consoleClient.apps.byAppId.workflows.draft.nodes.byNodeId.run.post
  >(),
)
vi.mock('@/service/base', () => ({ ssePost: request }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'apps.byAppId.workflows.draft.nodes.byNodeId.run.post': externalRun,
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'spec.schemaDefinitions.get': async () => [],
      'workspaces.current.tools.builtin.get': async () => [],
      'workspaces.current.tools.api.get': async () => [],
      'workspaces.current.tools.workflow.get': async () => [],
      'workspaces.current.tools.mcp.get': async () => [],
    }),
  }
})

// Checklist validation owns its own suite; this test follows container submission.
vi.mock('../../../../../../hooks/use-checklist', () => ({
  useWorkflowRunValidation: () => ({
    warningNodes: [],
  }),
}))

describe('useLastRun', () => {
  it('locks an external submission while its draft is saving and keeps Running when closing the form', async () => {
    const data: ExternalAgentWorkflowPreviewNodeData = {
      type: BlockEnum.Agent,
      title: 'External',
      desc: '',
      version: '2',
      agent_node_kind: 'external_a2a',
      agent_binding: {
        binding_type: 'roster_agent',
        agent_id: 'agent-1',
        binding_epoch: 'epoch-1',
      },
      agent_task: 'Review',
      agent_declared_outputs: [],
    }
    let callbacks: SyncDraftCallback | undefined
    const save = vi.fn((_skip: unknown, next?: SyncDraftCallback) => {
      callbacks = next
      return Promise.resolve()
    })
    externalRun.mockReset().mockResolvedValue({
      id: 'execution-1',
      status: 'paused',
      process_data: { external_invocation_id: 'invocation-1' },
    })
    const { result } = renderWorkflowCanvasHook(
      () => ({
        ...useLastRun({
          id: 'external',
          resource: { kind: 'app', appId: 'app-1', mode: 'workflow', collaborationEnabled: false },
          data,
          defaultRunInputData: {},
          isPaused: false,
        }),
        flow: useStoreApi(),
      }),
      {
        nodes: [createNode({ id: 'external', data })],
        hooksStoreProps: { doSyncWorkflowDraft: save },
      },
    )
    await act(async () => {
      await result.current.handleRunWithParams({})
      await result.current.handleRunWithParams({})
    })
    expect(save).toHaveBeenCalledOnce()
    expect(externalRun).not.toHaveBeenCalled()
    expect(
      result.current.flow
        .getState()
        .getNodes()
        .find((node) => node.id === 'external')?.data._singleRunningStatus,
    ).toBe('running')
    await act(async () => {
      callbacks?.onSuccess?.()
    })
    expect(externalRun).toHaveBeenCalledOnce()
    expect(
      result.current.flow
        .getState()
        .getNodes()
        .find((node) => node.id === 'external')?.data._singleRunningStatus,
    ).toBe('paused')
  })

  it('submits list inputs from the real container form using selector keys', async () => {
    const child: Node<ListFilterNodeType> = {
      id: 'list',
      parentId: 'iteration',
      position: { x: 0, y: 0 },
      data: {
        type: BlockEnum.ListFilter,
        title: 'List',
        desc: '',
        variable: ['source', 'items'],
        var_type: VarType.arrayNumber,
        item_var_type: VarType.number,
        filter_by: {
          enabled: true,
          conditions: [{ key: '', comparison_operator: '≥', value: '{{#source.minimum#}}' }],
        },
        extract_by: { enabled: true, serial: '{{#source.serial#}}' },
        order_by: { enabled: false, key: '', value: 'asc' },
        limit: { enabled: false },
      },
    }
    const data: IterationNodeType = {
      type: BlockEnum.Iteration,
      title: 'Iteration',
      desc: '',
      start_node_id: 'iteration-start',
      iterator_selector: ['source', 'items'],
      iterator_input_type: VarType.arrayNumber,
      output_selector: ['list', 'result'],
      output_type: VarType.arrayNumber,
      is_parallel: false,
      parallel_nums: 1,
      error_handle_mode: ErrorHandleMode.Terminated,
      flatten_output: false,
      _children: [{ nodeId: 'list', nodeType: BlockEnum.ListFilter }],
      _isShowTips: false,
    }
    const { result } = renderWorkflowCanvasHook(
      () => ({
        ...useLastRun({
          id: 'iteration',
          resource: {
            kind: 'app',
            collaborationEnabled: false,
            appId: 'flow-id',
            mode: 'workflow',
          },
          data,
          defaultRunInputData: {},
          isPaused: false,
        }),
        flow: useStoreApi(),
      }),
      {
        resource: { kind: 'app', collaborationEnabled: false, appId: 'flow-id', mode: 'workflow' },
        nodes: [
          createNode({
            id: 'source',
            data: {
              type: BlockEnum.Code,
              outputs: {
                items: { type: VarType.arrayNumber },
                minimum: { type: VarType.number },
                serial: { type: VarType.number },
              },
            },
          }),
          createNode({ id: 'iteration', data }),
          createNode({
            id: 'iteration-start',
            parentId: 'iteration',
            data: { type: BlockEnum.IterationStart },
          }),
          child,
        ],
        edges: [
          createEdge({ source: 'source', target: 'iteration' }),
          createEdge({ source: 'iteration-start', target: 'list' }),
        ],
        hooksStoreProps: {
          doSyncWorkflowDraft: async (_skip, callbacks) => callbacks?.onSuccess?.(),
        },
      },
    )

    await act(async () => {
      await result.current.handleRunWithParams({
        'source.items': [1, 2],
        'source.minimum': 0,
        'source.serial': 1,
        'iteration.input_selector': [1, 2],
      })
    })

    expect(request).toHaveBeenCalledWith(
      'apps/flow-id/workflows/draft/iteration/nodes/iteration/run',
      {
        body: {
          inputs: {
            'list.#source.items#': [1, 2],
            'list.#source.minimum#': 0,
            'list.#source.serial#': 1,
            'iteration.input_selector': [1, 2],
          },
        },
      },
      expect.any(Object),
    )
    expect(
      result.current.flow
        .getState()
        .getNodes()
        .find((node) => node.id === 'iteration')?.data._singleRunningStatus,
    ).toBe(NodeRunningStatus.Running)
  })
})
