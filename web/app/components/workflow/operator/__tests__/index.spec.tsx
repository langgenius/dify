import { act, screen, waitFor } from '@testing-library/react'
import { createNode } from '../../__tests__/fixtures'
import { renderWorkflowFlowComponent } from '../../__tests__/workflow-test-env'
import { BlockEnum } from '../../types'
import Operator from '../index'

const mockEmit = vi.fn()
const mockDeleteAllInspectorVars = vi.fn()

vi.mock('../../hooks/use-nodes-sync-draft', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/use-nodes-sync-draft')>()
  return {
    ...actual,
    useNodesSyncDraft: () => ({
      handleSyncWorkflowDraft: vi.fn(),
    }),
  }
})

vi.mock('../../hooks/use-workflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/use-workflow')>()
  return {
    ...actual,
    useWorkflowReadOnly: () => ({
      workflowReadOnly: false,
      getWorkflowReadOnly: () => false,
    }),
  }
})

vi.mock('../../hooks/use-inspect-vars-crud', () => ({
  default: () => ({
    conversationVars: [],
    systemVars: [],
    nodesWithInspectVars: [],
    deleteAllInspectorVars: mockDeleteAllInspectorVars,
  }),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: {
      emit: mockEmit,
    },
  }),
}))

const observers: MockResizeObserver[] = []

class MockResizeObserver implements ResizeObserver {
  target?: Element
  disconnect = vi.fn()
  readonly callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    observers.push(this)
  }
  observe(target: Element) {
    this.target = target
  }
  unobserve() {}
}

const renderOperator = (initialStoreState: Record<string, unknown> = {}) => {
  return renderWorkflowFlowComponent(<Operator handleUndo={vi.fn()} handleRedo={vi.fn()} />, {
    nodes: [
      createNode({
        id: 'node-1',
        data: {
          type: BlockEnum.Code,
          title: 'Code',
          desc: '',
        },
      }),
    ],
    edges: [],
    initialStoreState,
    historyStore: {
      nodes: [],
      edges: [],
    },
  })
}

describe('Operator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    observers.length = 0
    vi.stubGlobal('ResizeObserver', MockResizeObserver)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('should sync the observed panel size back into the workflow store and disconnect on unmount', async () => {
    const { store, unmount } = renderOperator({
      workflowCanvasWidth: 900,
      rightPanelWidth: 260,
    })

    const trigger = screen.getByText('workflowDebug.debug.variableInspect.trigger.normal')
    const observer = observers.find((candidate) => candidate.target?.contains(trigger))!
    expect(observer).toBeDefined()

    act(() => {
      const size = { inlineSize: 512, blockSize: 188 }
      observer.callback(
        [
          {
            target: observer.target!,
            borderBoxSize: [size],
            contentBoxSize: [size],
            devicePixelContentBoxSize: [size],
            contentRect: new DOMRect(0, 0, 512, 188),
          },
        ],
        observer,
      )
    })

    await waitFor(() => {
      expect(store.getState().bottomPanelWidth).toBe(512)
      expect(store.getState().bottomPanelHeight).toBe(188)
    })

    unmount()

    expect(observer.disconnect).toHaveBeenCalled()
  })
})
