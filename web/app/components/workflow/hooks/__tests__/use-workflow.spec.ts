import type { NodeDefault } from '../../types'
import { act } from '@testing-library/react'
import { createNode } from '../../__tests__/fixtures'
import {
  baseRunningData,
  renderWorkflowFlowHook,
  renderWorkflowHook,
} from '../../__tests__/workflow-test-env'
import { BlockClassification } from '../../block-selector/types'
import { BlockEnum, WorkflowRunningStatus } from '../../types'
import {
  useIsNodeInIteration,
  useIsNodeInLoop,
  useNodesReadOnly,
  useNodesReadOnlyByCanEdit,
  useWorkflow,
  useWorkflowReadOnly,
} from '../use-workflow'

beforeEach(() => {
  vi.clearAllMocks()
})

function createNodeDefault(type: BlockEnum): NodeDefault {
  return {
    metaData: {
      classification: BlockClassification.Default,
      sort: 0,
      type,
      title: type,
      author: 'test',
    },
    defaultValue: {},
    checkValid: () => ({ isValid: true }),
  }
}

describe('useWorkflowReadOnly', () => {
  it('should return workflowReadOnly true when status is Running', () => {
    const { result } = renderWorkflowHook(() => useWorkflowReadOnly(), {
      initialStoreState: {
        workflowRunningData: baseRunningData(),
      },
    })
    expect(result.current.workflowReadOnly).toBe(true)
  })

  it('should return workflowReadOnly false when status is Succeeded', () => {
    const { result } = renderWorkflowHook(() => useWorkflowReadOnly(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({
          result: { status: WorkflowRunningStatus.Succeeded },
        }),
      },
    })
    expect(result.current.workflowReadOnly).toBe(false)
  })

  it('should return workflowReadOnly false when no running data', () => {
    const { result } = renderWorkflowHook(() => useWorkflowReadOnly())
    expect(result.current.workflowReadOnly).toBe(false)
  })

  it('should return workflowReadOnly true when canvas is read only', () => {
    const { result } = renderWorkflowHook(() => useWorkflowReadOnly(), {
      initialStoreState: {
        canvasReadOnly: true,
      },
    })

    expect(result.current.workflowReadOnly).toBe(true)
  })

  it('should expose getWorkflowReadOnly that reads from store state', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowReadOnly())

    expect(result.current.getWorkflowReadOnly()).toBe(false)

    act(() => {
      store.setState({
        workflowRunningData: baseRunningData({ task_id: 'task-2' }),
      })
    })

    expect(result.current.getWorkflowReadOnly()).toBe(true)
  })
})

describe('useNodesReadOnly', () => {
  it('should use the default HooksStoreContext from the workflow test helper', () => {
    const { result } = renderWorkflowHook(() => useNodesReadOnly())
    expect(result.current.nodesReadOnly).toBe(false)
    expect(result.current.getNodesReadOnly()).toBe(false)
  })

  it('should return true when explicit edit permission is denied before HooksStoreContext is available', () => {
    const { result } = renderWorkflowHook(() => useNodesReadOnlyByCanEdit(false))
    expect(result.current.nodesReadOnly).toBe(true)
    expect(result.current.getNodesReadOnly()).toBe(true)
  })

  it('should expose getNodesReadOnly that reads from store state', () => {
    const { result, store } = renderWorkflowHook(() => useNodesReadOnly(), {
      hooksStoreProps: {},
    })

    expect(result.current.getNodesReadOnly()).toBe(false)

    act(() => {
      store.setState({ isRestoring: true })
    })
    expect(result.current.getNodesReadOnly()).toBe(true)
    expect(result.current.nodesReadOnly).toBe(true)
    act(() => store.setState({ isRestoring: false }))
    expect(result.current.nodesReadOnly).toBe(false)
    expect(result.current.getNodesReadOnly()).toBe(false)
  })

  it('should return true when status is Running', () => {
    const { result } = renderWorkflowHook(() => useNodesReadOnly(), {
      hooksStoreProps: {},
      initialStoreState: {
        workflowRunningData: baseRunningData(),
      },
    })
    expect(result.current.nodesReadOnly).toBe(true)
  })

  it('should return true when status is Paused', () => {
    const { result } = renderWorkflowHook(() => useNodesReadOnly(), {
      hooksStoreProps: {},
      initialStoreState: {
        workflowRunningData: baseRunningData({ result: { status: WorkflowRunningStatus.Paused } }),
      },
    })
    expect(result.current.nodesReadOnly).toBe(true)
  })

  it('should return true when historyWorkflowData is present', () => {
    const { result } = renderWorkflowHook(() => useNodesReadOnly(), {
      hooksStoreProps: {},
      initialStoreState: {
        historyWorkflowData: { id: 'run-1', status: 'succeeded' },
      },
    })
    expect(result.current.nodesReadOnly).toBe(true)
  })

  it('should return true when canvas is read only', () => {
    const { result } = renderWorkflowHook(() => useNodesReadOnly(), {
      initialStoreState: {
        canvasReadOnly: true,
      },
    })

    expect(result.current.nodesReadOnly).toBe(true)
  })

  it('should return true when edit permission is denied by HooksStoreContext', () => {
    const { result } = renderWorkflowHook(() => useNodesReadOnly(), {
      hooksStoreProps: {
        accessControl: {
          canEdit: false,
          canRun: true,
          canImportExportDSL: true,
          canReleaseAndVersion: true,
        },
      },
    })
    expect(result.current.nodesReadOnly).toBe(true)
    expect(result.current.getNodesReadOnly()).toBe(true)
  })
})

describe('useWorkflow connection validation', () => {
  it('should validate Agent V2 graph nodes against the Agent V2 catalog type', () => {
    const agentNode = createNode({
      id: 'agent-v2',
      data: {
        type: BlockEnum.Agent,
        title: 'Agent',
        desc: '',
        agent_node_kind: 'dify_agent',
        version: '2',
      },
    })
    const codeNode = createNode({
      id: 'code',
      data: {
        type: BlockEnum.Code,
        title: 'Code',
        desc: '',
      },
    })

    const { result } = renderWorkflowFlowHook(() => useWorkflow(), {
      nodes: [agentNode, codeNode],
      edges: [],
      hooksStoreProps: {
        availableNodesMetaData: {
          nodes: [createNodeDefault(BlockEnum.AgentV2), createNodeDefault(BlockEnum.Code)],
        },
      },
    })

    expect(
      result.current.isValidConnection({
        source: 'agent-v2',
        sourceHandle: 'source',
        target: 'code',
        targetHandle: 'target',
      }),
    ).toBe(true)
  })
})

describe.each([
  { name: 'iteration', useMembership: (id: string) => useIsNodeInIteration(id).isNodeInIteration },
  { name: 'loop', useMembership: (id: string) => useIsNodeInLoop(id).isNodeInLoop },
])('$name membership', ({ useMembership }) => {
  it('recognizes only direct children and tolerates missing nodes or parents', () => {
    const { result } = renderWorkflowFlowHook(
      () => ({
        contains: useMembership('parent'),
        missingParentContains: useMembership('missing-parent'),
      }),
      {
        nodes: [
          createNode({ id: 'parent' }),
          createNode({ id: 'child', parentId: 'parent' }),
          createNode({ id: 'grandchild', parentId: 'child' }),
          createNode({ id: 'outside' }),
        ],
        edges: [],
      },
    )
    expect(result.current.contains('child')).toBe(true)
    expect(result.current.contains('grandchild')).toBe(false)
    expect(result.current.contains('outside')).toBe(false)
    expect(result.current.contains('missing-node')).toBe(false)
    expect(result.current.missingParentContains('child')).toBe(false)
  })
})
