import type { CreateApiKeyResponse } from '@/models/app'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SecretKeyGenerateModal from '../secret-key-generate'

const createMockApiKey = (token: string): CreateApiKeyResponse => ({
  id: 'mock-id',
  token,
  created_at: '2024-01-01T00:00:00Z',
})

async function renderModal(ui: React.ReactElement) {
  const result = render(ui)
  await act(async () => {
    vi.runAllTimers()
  })
  return result
}

describe('SecretKeyGenerateModal', () => {
  const defaultProps = {
    isShow: true,
    onClose: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  describe('rendering when shown', () => {
    it('should render the modal when isShow is true', async () => {
      await renderModal(<SecretKeyGenerateModal {...defaultProps} />)
      expect(screen.getByText('appApi.apiKeyModal.apiSecretKey')).toBeInTheDocument()
    })

    it('should render the generate tips text', async () => {
      await renderModal(<SecretKeyGenerateModal {...defaultProps} />)
      expect(screen.getByText('appApi.apiKeyModal.generateTips')).toBeInTheDocument()
    })

    it('should render the OK button', async () => {
      await renderModal(<SecretKeyGenerateModal {...defaultProps} />)
      expect(screen.getByText('appApi.actionMsg.ok')).toBeInTheDocument()
    })

    it('should render the close icon', async () => {
      await renderModal(<SecretKeyGenerateModal {...defaultProps} />)
      const closeIcon = document.body.querySelector('svg.cursor-pointer')
      expect(closeIcon).toBeInTheDocument()
    })

    it('should render InputCopy component', async () => {
      await renderModal(<SecretKeyGenerateModal {...defaultProps} newKey={createMockApiKey('test-token-123')} />)
      expect(screen.getByText('test-token-123')).toBeInTheDocument()
    })
  })

  describe('rendering when hidden', () => {
    it('should not render content when isShow is false', async () => {
      await renderModal(<SecretKeyGenerateModal {...defaultProps} isShow={false} />)
      expect(screen.queryByText('appApi.apiKeyModal.apiSecretKey')).not.toBeInTheDocument()
    })
  })

  describe('newKey prop', () => {
    it('should display the token when newKey is provided', async () => {
      await renderModal(<SecretKeyGenerateModal {...defaultProps} newKey={createMockApiKey('sk-abc123xyz')} />)
      expect(screen.getByText('sk-abc123xyz')).toBeInTheDocument()
    })

    it('should handle undefined newKey', async () => {
      await renderModal(<SecretKeyGenerateModal {...defaultProps} newKey={undefined} />)
      expect(screen.getByText('appApi.apiKeyModal.apiSecretKey')).toBeInTheDocument()
    })

    it('should handle newKey with empty token', async () => {
      await renderModal(<SecretKeyGenerateModal {...defaultProps} newKey={createMockApiKey('')} />)
      expect(screen.getByText('appApi.apiKeyModal.apiSecretKey')).toBeInTheDocument()
    })

    it('should display long tokens correctly', async () => {
      const longToken = `sk-${'a'.repeat(100)}`
      await renderModal(<SecretKeyGenerateModal {...defaultProps} newKey={createMockApiKey(longToken)} />)
      expect(screen.getByText(longToken)).toBeInTheDocument()
    })
  })

  describe('close functionality', () => {
    it('should call onClose when X icon is clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onClose = vi.fn()
      await renderModal(<SecretKeyGenerateModal {...defaultProps} onClose={onClose} />)

      const closeIcon = document.body.querySelector('svg.cursor-pointer')
      expect(closeIcon).toBeInTheDocument()

      await act(async () => {
        await user.click(closeIcon!)
      })

      expect(onClose).toHaveBeenCalled()
    })

    it('should call onClose when OK button is clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onClose = vi.fn()
      await renderModal(<SecretKeyGenerateModal {...defaultProps} onClose={onClose} />)

      const okButton = screen.getByRole('button', { name: /ok/i })
      await act(async () => {
        await user.click(okButton)
      })

      expect(onClose).toHaveBeenCalled()
    })
  })

  describe('className prop', () => {
    it('should apply custom className', async () => {
      await renderModal(
        <SecretKeyGenerateModal {...defaultProps} className="custom-modal-class" />,
      )
      const modal = document.body.querySelector('.custom-modal-class')
      expect(modal).toBeInTheDocument()
    })

    it('should apply shrink-0 class', async () => {
      await renderModal(
        <SecretKeyGenerateModal {...defaultProps} className="shrink-0" />,
      )
      const modal = document.body.querySelector('.shrink-0')
      expect(modal).toBeInTheDocument()
    })
  })

  describe('modal styling', () => {
    it('should have px-8 padding', async () => {
      await renderModal(<SecretKeyGenerateModal {...defaultProps} />)
      const modal = document.body.querySelector('.px-8')
      expect(modal).toBeInTheDocument()
    })
  })

  describe('close icon styling', () => {
    it('should have cursor-pointer class on close icon', async () => {
      await renderModal(<SecretKeyGenerateModal {...defaultProps} />)
      const closeIcon = document.body.querySelector('svg.cursor-pointer')
      expect(closeIcon).toBeInTheDocument()
    })
  })

  describe('header section', () => {
    it('should have flex justify-end on close container', async () => {
      await renderModal(<SecretKeyGenerateModal {...defaultProps} />)
      const closeIcon = document.body.querySelector('svg.cursor-pointer')
      const closeContainer = closeIcon?.parentElement
      expect(closeContainer).toBeInTheDocument()
      expect(closeContainer?.className).toContain('flex')
      expect(closeContainer?.className).toContain('justify-end')
    })

    it('should have negative margin on close container', async () => {
      await renderModal(<SecretKeyGenerateModal {...defaultProps} />)
      const closeIcon = document.body.querySelector('svg.cursor-pointer')
      const closeContainer = closeIcon?.parentElement
      expect(closeContainer).toBeInTheDocument()
      expect(closeContainer?.className).toContain('-mr-2')
      expect(closeContainer?.className).toContain('-mt-6')
    })

    it('should have bottom margin on close container', async () => {
      await renderModal(<SecretKeyGenerateModal {...defaultProps} />)
      const closeIcon = document.body.querySelector('svg.cursor-pointer')
      const closeContainer = closeIcon?.parentElement
      expect(closeContainer).toBeInTheDocument()
      expect(closeContainer?.className).toContain('mb-4')
    })
  })

  describe('tips text styling', () => {
    it('should have mt-1 margin on tips', async () => {
      await renderModal(<SecretKeyGenerateModal {...defaultProps} />)
      const tips = screen.getByText('appApi.apiKeyModal.generateTips')
      expect(tips.className).toContain('mt-1')
    })

    it('should have correct font size', async () => {
      await renderModal(<SecretKeyGenerateModal {...defaultProps} />)
      const tips = screen.getByText('appApi.apiKeyModal.generateTips')
      expect(tips.className).toContain('text-[13px]')
    })

    it('should have normal font weight', async () => {
      await renderModal(<SecretKeyGenerateModal {...defaultProps} />)
      const tips = screen.getByText('appApi.apiKeyModal.generateTips')
      expect(tips.className).toContain('font-normal')
    })

    it('should have leading-5 line height', async () => {
      await renderModal(<SecretKeyGenerateModal {...defaultProps} />)
      const tips = screen.getByText('appApi.apiKeyModal.generateTips')
      expect(tips.className).toContain('leading-5')
    })

    it('should have tertiary text color', async () => {
      await renderModal(<SecretKeyGenerateModal {...defaultProps} />)
      const tips = screen.getByText('appApi.apiKeyModal.generateTips')
      expect(tips.className).toContain('text-text-tertiary')
    })
  })

  describe('InputCopy section', () => {
    it('should render InputCopy with token value', async () => {
      await renderModal(<SecretKeyGenerateModal {...defaultProps} newKey={createMockApiKey('test-token')} />)
      expect(screen.getByText('test-token')).toBeInTheDocument()
    })

    it('should have w-full class on InputCopy', async () => {
      await renderModal(<SecretKeyGenerateModal {...defaultProps} newKey={createMockApiKey('test')} />)
      const inputText = screen.getByText('test')
      const inputContainer = inputText.closest('.w-full')
      expect(inputContainer).toBeInTheDocument()
    })
  })

  describe('OK button section', () => {
    it('should render OK button', async () => {
      await renderModal(<SecretKeyGenerateModal {...defaultProps} />)
      const button = screen.getByRole('button', { name: /ok/i })
      expect(button).toBeInTheDocument()
    })

    it('should have button container with flex layout', async () => {
      await renderModal(<SecretKeyGenerateModal {...defaultProps} />)
      const button = screen.getByRole('button', { name: /ok/i })
      const container = button.parentElement
      expect(container).toBeInTheDocument()
      expect(container?.className).toContain('flex')
    })

    it('should have shrink-0 on button', async () => {
      await renderModal(<SecretKeyGenerateModal {...defaultProps} />)
      const button = screen.getByRole('button', { name: /ok/i })
      expect(button.className).toContain('shrink-0')
    })
  })

  describe('button text styling', () => {
    it('should have text-xs font size on button text', async () => {
      await renderModal(<SecretKeyGenerateModal {...defaultProps} />)
      const buttonText = screen.getByText('appApi.actionMsg.ok')
      expect(buttonText.className).toContain('text-xs')
    })

    it('should have font-medium on button text', async () => {
      await renderModal(<SecretKeyGenerateModal {...defaultProps} />)
      const buttonText = screen.getByText('appApi.actionMsg.ok')
      expect(buttonText.className).toContain('font-medium')
    })

    it('should have secondary text color on button text', async () => {
      await renderModal(<SecretKeyGenerateModal {...defaultProps} />)
      const buttonText = screen.getByText('appApi.actionMsg.ok')
      expect(buttonText.className).toContain('text-text-secondary')
    })
  })

  describe('default prop values', () => {
    it('should default isShow to false', async () => {
      await renderModal(<SecretKeyGenerateModal isShow={false} onClose={vi.fn()} />)
      expect(screen.queryByText('appApi.apiKeyModal.apiSecretKey')).not.toBeInTheDocument()
    })
  })

  describe('modal title', () => {
    it('should display the correct title', async () => {
      await renderModal(<SecretKeyGenerateModal {...defaultProps} />)
      expect(screen.getByText('appApi.apiKeyModal.apiSecretKey')).toBeInTheDocument()
    })
  })
})
