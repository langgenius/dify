import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createWorkflowRunningData } from '../../__tests__/fixtures'
import { renderWorkflowFlowComponent as render } from '../../__tests__/workflow-test-env'
import { ControlMode } from '../../types'
import Control from '../control'

const { mockHandleAddNote, mockHandleLayout } = vi.hoisted(() => ({
  mockHandleAddNote: vi.fn(),
  mockHandleLayout: vi.fn(),
}))

// Layout and note creation are independent operations; mode and permission owners stay real.
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

describe('Control', () => {
  it('switches modes through the real controls and reflects the current mode', async () => {
    const user = userEvent.setup()
    const { store } = render(<Control />, {
      initialStoreState: { controlMode: ControlMode.Pointer },
    })
    const pointer = screen.getByRole('button', { name: 'workflow.common.pointerMode' })
    const hand = screen.getByRole('button', { name: 'workflow.common.handMode' })
    const comment = screen.getByRole('button', { name: 'workflow.common.commentMode' })

    expect(pointer).toHaveAttribute('aria-pressed', 'true')
    await user.click(hand)
    expect(store.getState().controlMode).toBe(ControlMode.Hand)
    expect(hand).toHaveAttribute('aria-pressed', 'true')
    expect(pointer).toHaveAttribute('aria-pressed', 'false')
    await user.click(comment)
    expect(store.getState().controlMode).toBe(ControlMode.Comment)
    expect(comment).toHaveAttribute('aria-pressed', 'true')
    expect(hand).toHaveAttribute('aria-pressed', 'false')
    await user.click(pointer)
    expect(store.getState().controlMode).toBe(ControlMode.Pointer)
    expect(pointer).toHaveAttribute('aria-pressed', 'true')
    expect(comment).toHaveAttribute('aria-pressed', 'false')
  })

  it('dispatches note and layout actions', async () => {
    const user = userEvent.setup()
    render(<Control />)
    await user.click(screen.getByRole('button', { name: 'workflow.nodes.note.addNote' }))
    await user.click(screen.getByRole('button', { name: 'workflow.panel.organizeBlocks' }))
    expect(mockHandleAddNote).toHaveBeenCalledExactlyOnceWith()
    expect(mockHandleLayout).toHaveBeenCalledTimes(1)
  })

  it('should keep read-only actions focusable without activating them', async () => {
    const user = userEvent.setup()

    render(<Control />, {
      initialStoreState: { canvasReadOnly: true },
      reactFlowProps: { proOptions: { hideAttribution: true } },
    })

    const noteButton = screen.getByRole('button', { name: 'workflow.nodes.note.addNote' })

    expect(noteButton).toHaveAttribute('aria-disabled', 'true')
    await user.tab()
    expect(noteButton).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(mockHandleAddNote).not.toHaveBeenCalled()
  })

  it('should keep comment mode enabled when nodes are read-only', async () => {
    const user = userEvent.setup()

    const { store } = render(<Control />, {
      initialStoreState: { canvasReadOnly: true },
      reactFlowProps: { proOptions: { hideAttribution: true } },
    })

    const commentButton = screen.getByRole('button', { name: 'workflow.common.commentMode' })
    expect(commentButton).toBeEnabled()

    await user.click(commentButton)

    expect(store.getState().controlMode).toBe(ControlMode.Comment)
    expect(commentButton).toHaveAttribute('aria-pressed', 'true')
  })

  it('should keep blocked comment mode focusable without activating it', async () => {
    const user = userEvent.setup()

    const { store } = render(<Control />, {
      initialStoreState: {
        controlMode: ControlMode.Pointer,
        workflowRunningData: createWorkflowRunningData(),
      },
    })

    const commentButton = screen.getByRole('button', { name: 'workflow.common.commentMode' })
    expect(commentButton).toHaveAttribute('aria-disabled', 'true')

    commentButton.focus()
    expect(commentButton).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(store.getState().controlMode).toBe(ControlMode.Pointer)
    expect(commentButton).toHaveAttribute('aria-pressed', 'false')
  })
})
