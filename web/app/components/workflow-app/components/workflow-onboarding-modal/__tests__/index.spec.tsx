import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum } from '@/app/components/workflow/types'
import WorkflowOnboardingModal from '../index'

vi.mock('@/app/components/workflow/block-selector', () => ({
  default: function MockNodeSelector({
    open,
    onSelect,
    trigger,
  }: {
    open?: boolean
    onSelect: (type: BlockEnum, config?: Record<string, unknown>) => void
    trigger?: ((open: boolean) => ReactNode) | ReactNode
  }) {
    return (
      <div data-testid="mock-node-selector">
        {typeof trigger === 'function' ? trigger(Boolean(open)) : trigger}
        {open && (
          <div>
            <button data-testid="select-trigger-schedule" onClick={() => onSelect(BlockEnum.TriggerSchedule)}>
              Select Trigger Schedule
            </button>
            <button data-testid="select-trigger-webhook" onClick={() => onSelect(BlockEnum.TriggerWebhook, { config: 'test' })}>
              Select Trigger Webhook
            </button>
          </div>
        )}
      </div>
    )
  },
}))

describe('WorkflowOnboardingModal', () => {
  const mockOnClose = vi.fn()
  const mockOnSelectStartNode = vi.fn()

  const defaultProps = {
    isShow: true,
    onClose: mockOnClose,
    onSelectStartNode: mockOnSelectStartNode,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const renderComponent = (props = {}) => {
    return render(<WorkflowOnboardingModal {...defaultProps} {...props} />)
  }
  const getBackdrop = () => document.body.querySelector('.bg-workflow-canvas-canvas-overlay')
  const getUserInputHeading = () => screen.getByRole('heading', { name: 'workflow.onboarding.userInputFull' })
  const getTriggerHeading = () => screen.getByRole('heading', { name: 'workflow.onboarding.trigger' })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      renderComponent()

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('should render dialog when isShow is true', () => {
      renderComponent({ isShow: true })

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('should not render dialog when isShow is false', () => {
      renderComponent({ isShow: false })

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('should render title', () => {
      renderComponent()

      expect(screen.getByText('workflow.onboarding.title')).toBeInTheDocument()
    })

    it('should render description', () => {
      renderComponent()

      expect(screen.getByText('workflow.onboarding.description')).toBeInTheDocument()
    })

    it('should render StartNodeSelectionPanel', () => {
      renderComponent()

      expect(getUserInputHeading()).toBeInTheDocument()
      expect(getTriggerHeading()).toBeInTheDocument()
    })

    it('should not render ESC tip', () => {
      renderComponent({ isShow: true })

      expect(screen.queryByText('workflow.onboarding.escTip.press')).not.toBeInTheDocument()
      expect(screen.queryByText('workflow.onboarding.escTip.key')).not.toBeInTheDocument()
      expect(screen.queryByText('workflow.onboarding.escTip.toDismiss')).not.toBeInTheDocument()
    })

    it('should have correct styling for title', () => {
      renderComponent()

      const title = screen.getByText('workflow.onboarding.title')
      expect(title).toHaveClass('title-2xl-semi-bold')
      expect(title).toHaveClass('text-text-primary')
    })

    it('should have close button', () => {
      renderComponent()

      expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    })

    it('should render workflow canvas backdrop when shown', () => {
      renderComponent({ isShow: true })

      const backdrop = getBackdrop()
      expect(backdrop).toBeInTheDocument()
      expect(backdrop).not.toHaveClass('opacity-20')
    })
  })

  describe('Props', () => {
    it('should accept isShow prop', () => {
      const { rerender } = renderComponent({ isShow: false })

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

      rerender(<WorkflowOnboardingModal {...defaultProps} isShow={true} />)

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('should accept onClose prop', () => {
      const customOnClose = vi.fn()

      renderComponent({ onClose: customOnClose })

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('should accept onSelectStartNode prop', () => {
      const customHandler = vi.fn()

      renderComponent({ onSelectStartNode: customHandler })

      expect(getUserInputHeading()).toBeInTheDocument()
    })
  })

  describe('User Interactions - Start Node Selection', () => {
    it('should call onSelectStartNode with Start block when user input is selected', async () => {
      const user = userEvent.setup()
      renderComponent()

      await user.click(getUserInputHeading())

      expect(mockOnSelectStartNode).toHaveBeenCalledTimes(1)
      expect(mockOnSelectStartNode).toHaveBeenCalledWith(BlockEnum.Start)
    })

    it('should not call onClose when selecting user input (parent handles closing)', async () => {
      const user = userEvent.setup()
      renderComponent()

      await user.click(getUserInputHeading())

      expect(mockOnClose).not.toHaveBeenCalled()
    })

    it('should call onSelectStartNode with trigger type when trigger is selected', async () => {
      const user = userEvent.setup()
      renderComponent()

      await user.click(getTriggerHeading())
      await user.click(screen.getByTestId('select-trigger-schedule'))

      expect(mockOnSelectStartNode).toHaveBeenCalledTimes(1)
      expect(mockOnSelectStartNode).toHaveBeenCalledWith(BlockEnum.TriggerSchedule, undefined)
    })

    it('should not call onClose when selecting trigger (parent handles closing)', async () => {
      const user = userEvent.setup()
      renderComponent()

      await user.click(getTriggerHeading())
      await user.click(screen.getByTestId('select-trigger-schedule'))

      expect(mockOnClose).not.toHaveBeenCalled()
    })

    it('should pass tool config when selecting trigger with config', async () => {
      const user = userEvent.setup()
      renderComponent()

      await user.click(getTriggerHeading())
      await user.click(screen.getByTestId('select-trigger-webhook'))

      expect(mockOnSelectStartNode).toHaveBeenCalledTimes(1)
      expect(mockOnSelectStartNode).toHaveBeenCalledWith(BlockEnum.TriggerWebhook, { config: 'test' })
      expect(mockOnClose).not.toHaveBeenCalled()
    })
  })

  describe('User Interactions - Dialog Close', () => {
    it('should call onClose when close button is clicked', async () => {
      const user = userEvent.setup()
      renderComponent()

      await user.click(screen.getByRole('button', { name: 'Close' }))

      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })

    it('should not call onSelectStartNode when closing without selection', async () => {
      const user = userEvent.setup()
      renderComponent()

      await user.click(screen.getByRole('button', { name: 'Close' }))

      expect(mockOnSelectStartNode).not.toHaveBeenCalled()
      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })

    it('should call onClose exactly once when close button is clicked (no double-close)', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      renderComponent({ onClose })

      await user.click(screen.getByRole('button', { name: 'Close' }))

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should not call onClose when clicking backdrop', async () => {
      const user = userEvent.setup()
      renderComponent()

      const backdrop = getBackdrop()
      expect(backdrop).toBeInTheDocument()
      if (!backdrop)
        throw new Error('backdrop should exist when dialog is open')

      await user.click(backdrop)

      expect(mockOnClose).not.toHaveBeenCalled()
    })
  })

  describe('Keyboard Event Handling', () => {
    it('should call onClose when ESC key is pressed', () => {
      renderComponent({ isShow: true })

      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })

    it('should not call onClose when ESC is pressed but dialog is hidden', () => {
      renderComponent({ isShow: false })

      fireEvent.keyDown(document, { key: 'Escape' })

      expect(mockOnClose).not.toHaveBeenCalled()
    })

    it('should clean up on unmount', () => {
      const { unmount } = renderComponent({ isShow: true })

      unmount()
      fireEvent.keyDown(document, { key: 'Escape' })

      expect(mockOnClose).not.toHaveBeenCalled()
    })

    it('should respond to ESC based on open state', () => {
      const { rerender } = renderComponent({ isShow: true })

      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
      expect(mockOnClose).toHaveBeenCalledTimes(1)

      mockOnClose.mockClear()
      rerender(<WorkflowOnboardingModal {...defaultProps} isShow={false} />)

      fireEvent.keyDown(document, { key: 'Escape' })
      expect(mockOnClose).not.toHaveBeenCalled()
    })
  })

  describe('Edge Cases', () => {
    it('should handle rapid show/hide toggling', async () => {
      const { rerender } = renderComponent({ isShow: false })

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

      rerender(<WorkflowOnboardingModal {...defaultProps} isShow={true} />)
      expect(screen.getByRole('dialog')).toBeInTheDocument()

      rerender(<WorkflowOnboardingModal {...defaultProps} isShow={false} />)
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
    })

    it('should handle selecting multiple nodes in sequence', async () => {
      const user = userEvent.setup()
      const { rerender } = renderComponent()

      await user.click(getUserInputHeading())
      expect(mockOnSelectStartNode).toHaveBeenCalledWith(BlockEnum.Start)
      expect(mockOnClose).not.toHaveBeenCalled()

      mockOnSelectStartNode.mockClear()
      rerender(<WorkflowOnboardingModal {...defaultProps} isShow={true} />)

      await user.click(getTriggerHeading())
      await user.click(screen.getByTestId('select-trigger-schedule'))
      expect(mockOnSelectStartNode).toHaveBeenCalledWith(BlockEnum.TriggerSchedule, undefined)
      expect(mockOnClose).not.toHaveBeenCalled()
    })

    it('should handle prop updates correctly', () => {
      const { rerender } = renderComponent({ isShow: true })

      expect(screen.getByRole('dialog')).toBeInTheDocument()

      const newOnClose = vi.fn()
      const newOnSelectStartNode = vi.fn()
      rerender(
        <WorkflowOnboardingModal
          isShow={true}
          onClose={newOnClose}
          onSelectStartNode={newOnSelectStartNode}
        />,
      )

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('should maintain dialog when props change', () => {
      const { rerender } = renderComponent({ isShow: true })

      expect(screen.getByRole('dialog')).toBeInTheDocument()

      const newOnClose = vi.fn()
      rerender(<WorkflowOnboardingModal {...defaultProps} isShow={true} onClose={newOnClose} />)

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })

  describe('Accessibility', () => {
    it('should have dialog role', () => {
      renderComponent()

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('should have proper heading hierarchy', () => {
      renderComponent()

      const heading = screen.getByRole('heading', { name: 'workflow.onboarding.title' })
      expect(heading).toBeInTheDocument()
      expect(heading).toHaveTextContent('workflow.onboarding.title')
    })

    it('should expose dialog accessible name from title', () => {
      renderComponent()

      expect(screen.getByRole('dialog', { name: 'workflow.onboarding.title' })).toBeInTheDocument()
    })

    it('should support ESC key dismissal', () => {
      renderComponent({ isShow: true })

      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })

    it('should have proper text color classes', () => {
      renderComponent()

      const title = screen.getByText('workflow.onboarding.title')
      expect(title).toHaveClass('text-text-primary')
    })
  })

  describe('Integration', () => {
    it('should complete full flow of selecting user input node', async () => {
      const user = userEvent.setup()
      renderComponent()

      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText('workflow.onboarding.title')).toBeInTheDocument()
      expect(getUserInputHeading()).toBeInTheDocument()

      await user.click(getUserInputHeading())

      expect(mockOnSelectStartNode).toHaveBeenCalledWith(BlockEnum.Start)
      expect(mockOnClose).not.toHaveBeenCalled()
    })

    it('should complete full flow of selecting trigger node', async () => {
      const user = userEvent.setup()
      renderComponent()

      expect(screen.getByRole('dialog')).toBeInTheDocument()

      await user.click(getTriggerHeading())
      await user.click(screen.getByTestId('select-trigger-webhook'))

      expect(mockOnSelectStartNode).toHaveBeenCalledWith(BlockEnum.TriggerWebhook, { config: 'test' })
      expect(mockOnClose).not.toHaveBeenCalled()
    })

    it('should render all components in correct hierarchy', () => {
      renderComponent()

      const dialog = screen.getByRole('dialog')
      expect(dialog).toBeInTheDocument()
      expect(screen.getByText('workflow.onboarding.title')).toBeInTheDocument()
      expect(getUserInputHeading()).toBeInTheDocument()
    })

    it('should coordinate between keyboard and click interactions', async () => {
      const user = userEvent.setup()
      renderComponent()

      await user.click(screen.getByRole('button', { name: 'Close' }))
      expect(mockOnClose).toHaveBeenCalledTimes(1)

      mockOnClose.mockClear()
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })
  })
})
