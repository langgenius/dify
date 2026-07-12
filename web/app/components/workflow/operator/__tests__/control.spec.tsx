import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
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
let mockCanComment = true
let mockCanEdit = true
let mockCanUseCommentMode = true
let mockIsCommentModeAvailable = true
let mockStoreState: WorkflowStoreState

vi.mock('../../hooks', () => ({
  useNodesReadOnly: () => ({
    nodesReadOnly: mockNodesReadOnly,
    getNodesReadOnly: () => mockNodesReadOnly,
  }),
  useWorkflowMoveMode: () => ({
    handleModePointer: mockHandleModePointer,
    handleModeHand: mockHandleModeHand,
    handleModeComment: mockHandleModeComment,
    isCommentModeAvailable: mockIsCommentModeAvailable,
    canUseCommentMode: mockCanUseCommentMode,
  }),
  useWorkflowOrganize: () => ({
    handleLayout: mockHandleLayout,
  }),
}))

vi.mock('../hooks', () => ({
  useOperator: () => ({
    handleAddNote: mockHandleAddNote,
  }),
}))

vi.mock('../../store', () => ({
  useStore: (selector: (state: WorkflowStoreState) => unknown) => selector(mockStoreState),
}))

vi.mock('../../hooks-store', () => ({
  useHooksStore: <T,>(
    selector: (state: { accessControl: { canComment: boolean; canEdit: boolean } }) => T,
  ): T =>
    selector({
      accessControl: {
        canComment: mockCanComment,
        canEdit: mockCanEdit,
      },
    }),
}))

vi.mock('../add-block', () => ({
  default: () => <div data-testid="add-block" />,
}))

vi.mock('../more-actions', () => ({
  default: () => <div data-testid="more-actions" />,
}))

vi.mock('../tip-popup', () => ({
  default: ({ children, title }: { children?: ReactNode; title?: string }) => (
    <div data-testid={title}>{children}</div>
  ),
}))

describe('Control', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNodesReadOnly = false
    mockCanComment = true
    mockCanEdit = true
    mockCanUseCommentMode = true
    mockIsCommentModeAvailable = true
    mockStoreState = {
      controlMode: ControlMode.Pointer,
    }
  })

  // Rendering and visual states for control buttons.
  describe('Rendering', () => {
    it('should render the child action groups and highlight the active pointer mode', () => {
      render(<Control />)

      expect(screen.getByTestId('add-block')).toBeInTheDocument()
      expect(screen.getByTestId('more-actions')).toBeInTheDocument()
      expect(screen.getByTestId('workflow.common.pointerMode').firstElementChild).toHaveClass(
        'bg-state-accent-active',
      )
      expect(screen.getByTestId('workflow.common.handMode').firstElementChild).not.toHaveClass(
        'bg-state-accent-active',
      )
    })

    it('should highlight hand mode when it is active', () => {
      mockStoreState = {
        controlMode: ControlMode.Hand,
      }

      render(<Control />)

      expect(screen.getByTestId('workflow.common.handMode').firstElementChild).toHaveClass(
        'bg-state-accent-active',
      )
    })
  })

  // User interactions exposed by the control bar.
  describe('User Interactions', () => {
    it('should trigger the note, mode, and organize handlers', () => {
      render(<Control />)

      fireEvent.click(
        screen.getByTestId('workflow.nodes.note.addNote').firstElementChild as HTMLElement,
      )
      fireEvent.click(
        screen.getByTestId('workflow.common.pointerMode').firstElementChild as HTMLElement,
      )
      fireEvent.click(
        screen.getByTestId('workflow.common.handMode').firstElementChild as HTMLElement,
      )
      fireEvent.click(
        screen.getByTestId('workflow.common.commentMode').firstElementChild as HTMLElement,
      )
      fireEvent.click(
        screen.getByTestId('workflow.panel.organizeBlocks').firstElementChild as HTMLElement,
      )

      expect(mockHandleAddNote).toHaveBeenCalledTimes(1)
      expect(mockHandleModePointer).toHaveBeenCalledTimes(1)
      expect(mockHandleModeHand).toHaveBeenCalledTimes(1)
      expect(mockHandleModeComment).toHaveBeenCalledTimes(1)
      expect(mockHandleLayout).toHaveBeenCalledTimes(1)
    })

    it('should block note creation when editing is not allowed', () => {
      mockCanEdit = false
      mockCanComment = true
      mockNodesReadOnly = true

      render(<Control />)

      fireEvent.click(
        screen.getByTestId('workflow.nodes.note.addNote').firstElementChild as HTMLElement,
      )

      expect(mockHandleAddNote).not.toHaveBeenCalled()
    })

    it('should keep comment mode enabled for readonly layout users who can comment', () => {
      mockNodesReadOnly = true
      mockCanUseCommentMode = true

      render(<Control />)

      const commentButton = screen.getByTestId('workflow.common.commentMode')
        .firstElementChild as HTMLButtonElement
      expect(commentButton).toBeEnabled()

      fireEvent.click(commentButton)

      expect(mockHandleModeComment).toHaveBeenCalledTimes(1)
    })

    it('should disable comment mode when comment operation is blocked', () => {
      mockCanUseCommentMode = false

      render(<Control />)

      const commentButton = screen.getByTestId('workflow.common.commentMode')
        .firstElementChild as HTMLButtonElement
      expect(commentButton).toBeDisabled()

      fireEvent.click(commentButton)

      expect(mockHandleModeComment).not.toHaveBeenCalled()
    })
  })
})
