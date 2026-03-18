import { act, fireEvent, render } from '@testing-library/react'
import UndoRedo from '../undo-redo'

type TemporalSnapshot = {
  pastStates: unknown[]
  futureStates: unknown[]
}

const mockUnsubscribe = vi.fn()
const mockTemporalSubscribe = vi.fn()
const mockHandleUndo = vi.fn()
const mockHandleRedo = vi.fn()

let latestTemporalListener: ((state: TemporalSnapshot) => void) | undefined
let mockNodesReadOnly = false

vi.mock('@/app/components/workflow/header/view-workflow-history', () => ({
  default: () => <div data-testid="view-workflow-history" />,
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesReadOnly: () => ({
    nodesReadOnly: mockNodesReadOnly,
  }),
}))

vi.mock('@/app/components/workflow/workflow-history-store', () => ({
  useWorkflowHistoryStore: () => ({
    store: {
      temporal: {
        subscribe: mockTemporalSubscribe,
      },
    },
    shortcutsEnabled: true,
    setShortcutsEnabled: vi.fn(),
  }),
}))

vi.mock('@/app/components/base/divider', () => ({
  default: () => <div data-testid="divider" />,
}))

vi.mock('@/app/components/workflow/operator/tip-popup', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}))

describe('UndoRedo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNodesReadOnly = false
    latestTemporalListener = undefined
    mockTemporalSubscribe.mockImplementation((listener: (state: TemporalSnapshot) => void) => {
      latestTemporalListener = listener
      return mockUnsubscribe
    })
  })

  it('enables undo and redo when history exists and triggers the callbacks', () => {
    const { container } = render(<UndoRedo handleRedo={mockHandleRedo} handleUndo={mockHandleUndo} />)

    act(() => {
      latestTemporalListener?.({
        pastStates: [{}],
        futureStates: [{}],
      })
    })

    fireEvent.click(container.querySelector('[data-tooltip-id="workflow.undo"]') as HTMLDivElement)
    fireEvent.click(container.querySelector('[data-tooltip-id="workflow.redo"]') as HTMLDivElement)

    expect(mockHandleUndo).toHaveBeenCalledTimes(1)
    expect(mockHandleRedo).toHaveBeenCalledTimes(1)
  })

  it('keeps the buttons disabled before history is available', () => {
    const { container } = render(<UndoRedo handleRedo={mockHandleRedo} handleUndo={mockHandleUndo} />)
    const undoButton = container.querySelector('[data-tooltip-id="workflow.undo"]') as HTMLDivElement
    const redoButton = container.querySelector('[data-tooltip-id="workflow.redo"]') as HTMLDivElement

    fireEvent.click(undoButton)
    fireEvent.click(redoButton)

    expect(undoButton).toHaveClass('cursor-not-allowed')
    expect(redoButton).toHaveClass('cursor-not-allowed')
    expect(mockHandleUndo).not.toHaveBeenCalled()
    expect(mockHandleRedo).not.toHaveBeenCalled()
  })

  it('does not trigger callbacks when the canvas is read only', () => {
    mockNodesReadOnly = true
    const { container } = render(<UndoRedo handleRedo={mockHandleRedo} handleUndo={mockHandleUndo} />)
    const undoButton = container.querySelector('[data-tooltip-id="workflow.undo"]') as HTMLDivElement
    const redoButton = container.querySelector('[data-tooltip-id="workflow.redo"]') as HTMLDivElement

    act(() => {
      latestTemporalListener?.({
        pastStates: [{}],
        futureStates: [{}],
      })
    })

    fireEvent.click(undoButton)
    fireEvent.click(redoButton)

    expect(undoButton).toHaveClass('cursor-not-allowed')
    expect(redoButton).toHaveClass('cursor-not-allowed')
    expect(mockHandleUndo).not.toHaveBeenCalled()
    expect(mockHandleRedo).not.toHaveBeenCalled()
  })

  it('unsubscribes from the temporal store on unmount', () => {
    const { unmount } = render(<UndoRedo handleRedo={mockHandleRedo} handleUndo={mockHandleUndo} />)

    unmount()

    expect(mockUnsubscribe).toHaveBeenCalledTimes(1)
  })
})
