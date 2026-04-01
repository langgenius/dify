import { act, fireEvent, render, screen } from '@testing-library/react'
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
    render(<UndoRedo handleRedo={mockHandleRedo} handleUndo={mockHandleUndo} />)

    act(() => {
      latestTemporalListener?.({
        pastStates: [{}],
        futureStates: [{}],
      })
    })

    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.undo' }))
    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.redo' }))

    expect(mockHandleUndo).toHaveBeenCalledTimes(1)
    expect(mockHandleRedo).toHaveBeenCalledTimes(1)
  })

  it('keeps the buttons disabled before history is available', () => {
    render(<UndoRedo handleRedo={mockHandleRedo} handleUndo={mockHandleUndo} />)
    const undoButton = screen.getByRole('button', { name: 'workflow.common.undo' })
    const redoButton = screen.getByRole('button', { name: 'workflow.common.redo' })

    fireEvent.click(undoButton)
    fireEvent.click(redoButton)

    expect(undoButton).toBeDisabled()
    expect(redoButton).toBeDisabled()
    expect(mockHandleUndo).not.toHaveBeenCalled()
    expect(mockHandleRedo).not.toHaveBeenCalled()
  })

  it('does not trigger callbacks when the canvas is read only', () => {
    mockNodesReadOnly = true
    render(<UndoRedo handleRedo={mockHandleRedo} handleUndo={mockHandleUndo} />)
    const undoButton = screen.getByRole('button', { name: 'workflow.common.undo' })
    const redoButton = screen.getByRole('button', { name: 'workflow.common.redo' })

    act(() => {
      latestTemporalListener?.({
        pastStates: [{}],
        futureStates: [{}],
      })
    })

    fireEvent.click(undoButton)
    fireEvent.click(redoButton)

    expect(undoButton).toBeDisabled()
    expect(redoButton).toBeDisabled()
    expect(mockHandleUndo).not.toHaveBeenCalled()
    expect(mockHandleRedo).not.toHaveBeenCalled()
  })

  it('unsubscribes from the temporal store on unmount', () => {
    const { unmount } = render(<UndoRedo handleRedo={mockHandleRedo} handleUndo={mockHandleUndo} />)

    unmount()

    expect(mockUnsubscribe).toHaveBeenCalledTimes(1)
  })
})
