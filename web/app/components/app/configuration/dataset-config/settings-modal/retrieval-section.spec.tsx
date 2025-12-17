import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

jest.mock('@/app/components/datasets/external-knowledge-base/create/RetrievalSettings', () => ({
  __esModule: true,
  default: () => <div data-testid='retrieval-settings-mock' />,
}))

jest.mock('@/app/components/datasets/common/retrieval-method-config', () => ({
  __esModule: true,
  default: () => <div data-testid='retrieval-method-config-mock' />,
}))

jest.mock('@/app/components/datasets/common/economical-retrieval-method-config', () => ({
  __esModule: true,
  default: () => <div data-testid='economical-retrieval-method-config-mock' />,
}))

jest.mock('@/app/components/datasets/create/step-two', () => ({
  __esModule: true,
  IndexingType: {
    QUALIFIED: 'qualified',
    ECONOMICAL: 'economy',
  },
}))

import { RetrievalChangeTip } from './retrieval-section'

describe('RetrievalChangeTip', () => {
  const defaultProps = {
    visible: true,
    message: 'Test message',
    onDismiss: jest.fn(),
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing when visible', () => {
      render(<RetrievalChangeTip {...defaultProps} />)

      expect(screen.getByText('Test message')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'close-retrieval-change-tip' })).toBeInTheDocument()
    })

    it('should not render when not visible', () => {
      render(<RetrievalChangeTip {...defaultProps} visible={false} />)

      expect(screen.queryByText('Test message')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('close-retrieval-change-tip')).not.toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should display the correct message', () => {
      render(<RetrievalChangeTip {...defaultProps} message='Custom warning message' />)

      expect(screen.getByText('Custom warning message')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onDismiss when close button is clicked', async () => {
      const onDismiss = jest.fn()
      render(<RetrievalChangeTip {...defaultProps} onDismiss={onDismiss} />)
      await userEvent.click(screen.getByRole('button', { name: 'close-retrieval-change-tip' }))

      expect(onDismiss).toHaveBeenCalledTimes(1)
    })

    it('should prevent click bubbling when close button is clicked', async () => {
      const onDismiss = jest.fn()
      const parentClick = jest.fn()
      render(
        <div onClick={parentClick}>
          <RetrievalChangeTip {...defaultProps} onDismiss={onDismiss} />
        </div>,
      )

      await userEvent.click(screen.getByRole('button', { name: 'close-retrieval-change-tip' }))

      expect(onDismiss).toHaveBeenCalledTimes(1)
      expect(parentClick).not.toHaveBeenCalled()
    })
  })
})
