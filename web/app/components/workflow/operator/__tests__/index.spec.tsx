import { act, screen } from '@testing-library/react'
import { createNode } from '../../__tests__/fixtures'
import { renderWorkflowFlowComponent } from '../../__tests__/workflow-test-env'
import { BlockEnum } from '../../types'
import Operator from '../index'

const mockEmit = vi.fn()
const mockDeleteAllInspectorVars = vi.fn()

vi.mock('../../hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks')>()
  return {
    ...actual,
    useNodesSyncDraft: () => ({
      handleSyncWorkflowDraft: vi.fn(),
    }),
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

const originalResizeObserver = globalThis.ResizeObserver
let resizeObserverCallback: ResizeObserverCallback | undefined
const observeSpy = vi.fn()
const disconnectSpy = vi.fn()

class MockResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeObserverCallback = callback
  }

  observe(...args: Parameters<ResizeObserver['observe']>) {
    observeSpy(...args)
  }

  unobserve() {
    return undefined
  }

  disconnect() {
    disconnectSpy()
  }
}

const renderOperator = (initialStoreState: Record<string, unknown> = {}) => {
  return renderWorkflowFlowComponent(
    <Operator handleUndo={vi.fn()} handleRedo={vi.fn()} />,
    {
      nodes: [createNode({
        id: 'node-1',
        data: {
          type: BlockEnum.Code,
          title: 'Code',
          desc: '',
        },
      })],
      edges: [],
      initialStoreState,
      historyStore: {
        nodes: [],
        edges: [],
      },
    },
  )
}

describe('Operator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resizeObserverCallback = undefined
    vi.stubGlobal('ResizeObserver', MockResizeObserver as unknown as typeof ResizeObserver)
  })

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver
  })

  it('should keep the operator width on the 400px floor when the available width is smaller', () => {
    const { container } = renderOperator({
      workflowCanvasWidth: 620,
      rightPanelWidth: 350,
    })

    expect(screen.getByText('workflow.debug.variableInspect.trigger.normal')).toBeInTheDocument()
    expect(container.querySelector('div[style*="width: 400px"]')).toBeInTheDocument()
  })

  it('should fall back to auto width before layout metrics are ready', () => {
    const { container } = renderOperator()

    expect(container.querySelector('div[style*="width: auto"]')).toBeInTheDocument()
  })

  it('should sync the observed panel size back into the workflow store and disconnect on unmount', () => {
    const { store, unmount } = renderOperator({
      workflowCanvasWidth: 900,
      rightPanelWidth: 260,
    })

    expect(observeSpy).toHaveBeenCalled()

    act(() => {
      resizeObserverCallback?.([
        {
          borderBoxSize: [{ inlineSize: 512, blockSize: 188 }],
        } as unknown as ResizeObserverEntry,
      ], {} as ResizeObserver)
    })

    expect(store.getState().bottomPanelWidth).toBe(512)
    expect(store.getState().bottomPanelHeight).toBe(188)

    unmount()

    expect(disconnectSpy).toHaveBeenCalled()
  })
})
