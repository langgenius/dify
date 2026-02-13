import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PromptLogModal from '.'

describe('PromptLogModal', () => {
  const defaultProps = {
    width: 1000,
    onCancel: vi.fn(),
    currentLogItem: {
      id: '1',
      content: 'test',
      log: [{ role: 'user', text: 'Hello' }],
    } as Parameters<typeof PromptLogModal>[0]['currentLogItem'],
  }

  describe('Render', () => {
    it('renders correctly when currentLogItem is provided', () => {
      render(<PromptLogModal {...defaultProps} />)
      expect(screen.getByText('PROMPT LOG')).toBeInTheDocument()
      expect(screen.getByText('Hello')).toBeInTheDocument()
    })

    it('returns null when currentLogItem is missing', () => {
      const { container } = render(<PromptLogModal {...defaultProps} currentLogItem={undefined} />)
      expect(container.firstChild).toBeNull()
    })

    it('renders copy feedback when log length is 1', () => {
      render(<PromptLogModal {...defaultProps} />)
      expect(screen.getByTestId('close-btn-container')).toBeInTheDocument()
    })
  })

  describe('Interactions', () => {
    it('calls onCancel when close button is clicked', () => {
      render(<PromptLogModal {...defaultProps} />)
      const closeBtn = screen.getByTestId('close-btn')
      expect(closeBtn).toBeInTheDocument()
      fireEvent.click(closeBtn)
      expect(defaultProps.onCancel).toHaveBeenCalled()
    })

    it('calls onCancel when clicking outside', async () => {
      const user = userEvent.setup()
      const onCancel = vi.fn()
      render(
        <div>
          <div data-testid="outside">Outside</div>
          <PromptLogModal {...defaultProps} onCancel={onCancel} />
        </div>,
      )

      await waitFor(() => {
        expect(screen.getByTestId('close-btn')).toBeInTheDocument()
      })

      await user.click(screen.getByTestId('outside'))
    })
  })
})
