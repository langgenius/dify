import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { ControlMode } from '../../types'
import Control from '../control'

type WorkflowStoreState = {
  controlMode: ControlMode
  maximizeCanvas: boolean
}

const {
  mockHandleAddNote,
  mockHandleLayout,
  mockHandleModeHand,
  mockHandleModePointer,
  mockHandleToggleMaximizeCanvas,
} = vi.hoisted(() => ({
  mockHandleAddNote: vi.fn(),
  mockHandleLayout: vi.fn(),
  mockHandleModeHand: vi.fn(),
  mockHandleModePointer: vi.fn(),
  mockHandleToggleMaximizeCanvas: vi.fn(),
}))

let mockNodesReadOnly = false
let mockStoreState: WorkflowStoreState

vi.mock('../../hooks', () => ({
  useNodesReadOnly: () => ({
    nodesReadOnly: mockNodesReadOnly,
    getNodesReadOnly: () => mockNodesReadOnly,
  }),
  useWorkflowCanvasMaximize: () => ({
    handleToggleMaximizeCanvas: mockHandleToggleMaximizeCanvas,
  }),
  useWorkflowMoveMode: () => ({
    handleModePointer: mockHandleModePointer,
    handleModeHand: mockHandleModeHand,
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

vi.mock('../add-block', () => ({
  default: () => <div data-testid="add-block" />,
}))

vi.mock('../more-actions', () => ({
  default: () => <div data-testid="more-actions" />,
}))

vi.mock('../tip-popup', () => ({
  default: ({
    children,
    title,
  }: {
    children?: ReactNode
    title?: string
  }) => <div data-testid={title}>{children}</div>,
}))

describe('Control', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNodesReadOnly = false
    mockStoreState = {
      controlMode: ControlMode.Pointer,
      maximizeCanvas: false,
    }
  })

  // Rendering and visual states for control buttons.
  describe('Rendering', () => {
    it('should render the child action groups and highlight the active pointer mode', () => {
      render(<Control />)

      expect(screen.getByTestId('add-block')).toBeInTheDocument()
      expect(screen.getByTestId('more-actions')).toBeInTheDocument()
      expect(screen.getByTestId('workflow.common.pointerMode').firstElementChild).toHaveClass('bg-state-accent-active')
      expect(screen.getByTestId('workflow.common.handMode').firstElementChild).not.toHaveClass('bg-state-accent-active')
      expect(screen.getByTestId('workflow.panel.maximize')).toBeInTheDocument()
    })

    it('should switch the maximize tooltip and active style when the canvas is maximized', () => {
      mockStoreState = {
        controlMode: ControlMode.Hand,
        maximizeCanvas: true,
      }

      render(<Control />)

      expect(screen.getByTestId('workflow.common.handMode').firstElementChild).toHaveClass('bg-state-accent-active')
      expect(screen.getByTestId('workflow.panel.minimize').firstElementChild).toHaveClass('bg-state-accent-active')
    })
  })

  // User interactions exposed by the control bar.
  describe('User Interactions', () => {
    it('should trigger the note, mode, organize, and maximize handlers', () => {
      render(<Control />)

      fireEvent.click(screen.getByTestId('workflow.nodes.note.addNote').firstElementChild as HTMLElement)
      fireEvent.click(screen.getByTestId('workflow.common.pointerMode').firstElementChild as HTMLElement)
      fireEvent.click(screen.getByTestId('workflow.common.handMode').firstElementChild as HTMLElement)
      fireEvent.click(screen.getByTestId('workflow.panel.organizeBlocks').firstElementChild as HTMLElement)
      fireEvent.click(screen.getByTestId('workflow.panel.maximize').firstElementChild as HTMLElement)

      expect(mockHandleAddNote).toHaveBeenCalledTimes(1)
      expect(mockHandleModePointer).toHaveBeenCalledTimes(1)
      expect(mockHandleModeHand).toHaveBeenCalledTimes(1)
      expect(mockHandleLayout).toHaveBeenCalledTimes(1)
      expect(mockHandleToggleMaximizeCanvas).toHaveBeenCalledTimes(1)
    })

    it('should block note creation when the workflow is read only', () => {
      mockNodesReadOnly = true

      render(<Control />)

      fireEvent.click(screen.getByTestId('workflow.nodes.note.addNote').firstElementChild as HTMLElement)

      expect(mockHandleAddNote).not.toHaveBeenCalled()
    })
  })
})
