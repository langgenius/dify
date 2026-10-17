import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowComponent as renderComponent } from '../../__tests__/workflow-test-env'
import { ControlMode } from '../../types'
import Control from '../control'

type WorkflowStoreState = {
  controlMode: ControlMode
}

const {
  mockHandleAddNote,
  mockHandleLayout,
  mockHandleModeComment,
  mockHandleModeHand,
  mockHandleModePointer,
} = vi.hoisted(() => ({
  mockHandleAddNote: vi.fn(),
  mockHandleLayout: vi.fn(),
  mockHandleModeComment: vi.fn(),
  mockHandleModeHand: vi.fn(),
  mockHandleModePointer: vi.fn(),
}))

let mockNodesReadOnly = false
let mockCanUseCommentMode = true
let mockIsCommentModeAvailable = true
let mockStoreState: WorkflowStoreState

vi.mock('../../hooks/use-workflow', () => ({
  useNodesReadOnly: () => ({
    nodesReadOnly: mockNodesReadOnly,
    getNodesReadOnly: () => mockNodesReadOnly,
  }),
}))

vi.mock('../../hooks/use-workflow-panel-interactions', () => ({
  useWorkflowMoveMode: () => ({
    handleModePointer: mockHandleModePointer,
    handleModeHand: mockHandleModeHand,
    handleModeComment: mockHandleModeComment,
    isCommentModeAvailable: mockIsCommentModeAvailable,
    canUseCommentMode: mockCanUseCommentMode,
  }),
}))

vi.mock('../../hooks/use-workflow-organize', () => ({
  useWorkflowOrganize: () => ({
    handleLayout: mockHandleLayout,
  }),
}))

vi.mock('../hooks', () => ({
  useOperator: () => ({
    handleAddNote: mockHandleAddNote,
  }),
}))

vi.mock('../add-block', () => ({
  default: () => <div data-testid="add-block" />,
}))

vi.mock('../export-image', () => ({
  ExportImage: () => <div data-testid="export-image" />,
}))

const render = (ui: React.ReactElement) =>
  renderComponent(ui, { initialStoreState: mockStoreState })

describe('Control', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNodesReadOnly = false
    mockCanUseCommentMode = true
    mockIsCommentModeAvailable = true
    mockStoreState = {
      controlMode: ControlMode.Pointer,
    }
  })

  // Rendering and semantic states for control buttons.
  describe('Rendering', () => {
    it('should render the child action groups and highlight the active pointer mode', () => {
      render(<Control />)

      expect(screen.getByRole('button', { name: 'workflow.common.pointerMode' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      expect(screen.getByRole('button', { name: 'workflow.common.handMode' })).toHaveAttribute(
        'aria-pressed',
        'false',
      )
    })

    it('should highlight hand mode when it is active', () => {
      mockStoreState = {
        controlMode: ControlMode.Hand,
      }

      render(<Control />)

      expect(screen.getByRole('button', { name: 'workflow.common.handMode' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    })
  })

  // User interactions exposed by the control bar.
  describe('User Interactions', () => {
    it('should trigger the note, mode, and organize handlers', async () => {
      const user = userEvent.setup()
      render(<Control />)

      await user.click(screen.getByRole('button', { name: 'workflow.nodes.note.addNote' }))
      await user.click(screen.getByRole('button', { name: 'workflow.common.pointerMode' }))
      await user.click(screen.getByRole('button', { name: 'workflow.common.handMode' }))
      await user.click(screen.getByRole('button', { name: 'workflow.common.commentMode' }))
      await user.click(screen.getByRole('button', { name: 'workflow.panel.organizeBlocks' }))

      expect(mockHandleAddNote).toHaveBeenCalledTimes(1)
      expect(mockHandleModePointer).toHaveBeenCalledTimes(1)
      expect(mockHandleModeHand).toHaveBeenCalledTimes(1)
      expect(mockHandleModeComment).toHaveBeenCalledTimes(1)
      expect(mockHandleLayout).toHaveBeenCalledTimes(1)
    })

    it('should keep read-only actions focusable without activating them', async () => {
      const user = userEvent.setup()
      mockNodesReadOnly = true

      render(<Control />)

      const noteButton = screen.getByRole('button', { name: 'workflow.nodes.note.addNote' })

      expect(noteButton).toHaveAttribute('aria-disabled', 'true')
      await user.tab()
      expect(noteButton).toHaveFocus()
      await user.keyboard('{Enter}')

      expect(mockHandleAddNote).not.toHaveBeenCalled()
    })

    it('should keep comment mode enabled when nodes are read-only', async () => {
      const user = userEvent.setup()
      mockNodesReadOnly = true
      mockCanUseCommentMode = true

      render(<Control />)

      const commentButton = screen.getByRole('button', { name: 'workflow.common.commentMode' })
      expect(commentButton).toBeEnabled()

      await user.click(commentButton)

      expect(mockHandleModeComment).toHaveBeenCalledTimes(1)
    })

    it('should keep blocked comment mode focusable without activating it', async () => {
      const user = userEvent.setup()
      mockCanUseCommentMode = false

      render(<Control />)

      const commentButton = screen.getByRole('button', { name: 'workflow.common.commentMode' })
      expect(commentButton).toHaveAttribute('aria-disabled', 'true')

      commentButton.focus()
      expect(commentButton).toHaveFocus()
      await user.keyboard('{Enter}')

      expect(mockHandleModeComment).not.toHaveBeenCalled()
    })
  })
})
