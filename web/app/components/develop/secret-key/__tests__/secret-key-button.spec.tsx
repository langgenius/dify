import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SecretKeyButton from '../secret-key-button'

vi.mock('@/app/components/develop/secret-key/secret-key-modal', () => ({
  default: ({ isShow, onClose, appId }: { isShow: boolean, onClose: () => void, appId?: string }) => (
    isShow
      ? (
          <div data-testid="secret-key-modal">
            <span data-testid="modal-app-id">{`Modal for ${appId || 'no-app'}`}</span>
            <button onClick={onClose} data-testid="close-modal">Close</button>
          </div>
        )
      : null
  ),
}))

describe('SecretKeyButton', () => {
  describe('rendering', () => {
    it('should render the button', () => {
      render(<SecretKeyButton />)
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should render the API key text', () => {
      render(<SecretKeyButton />)
      expect(screen.getByText('appApi.apiKey')).toBeInTheDocument()
    })

    it('should render the key icon', () => {
      const { container } = render(<SecretKeyButton />)
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('should not show modal initially', () => {
      render(<SecretKeyButton />)
      expect(screen.queryByTestId('secret-key-modal')).not.toBeInTheDocument()
    })
  })

  describe('button interaction', () => {
    it('should open modal when button is clicked', async () => {
      const user = userEvent.setup()
      render(<SecretKeyButton />)

      const button = screen.getByRole('button')
      await act(async () => {
        await user.click(button)
      })

      expect(screen.getByTestId('secret-key-modal')).toBeInTheDocument()
    })

    it('should close modal when onClose is called', async () => {
      const user = userEvent.setup()
      render(<SecretKeyButton />)

      const button = screen.getByRole('button')
      await act(async () => {
        await user.click(button)
      })

      expect(screen.getByTestId('secret-key-modal')).toBeInTheDocument()

      const closeButton = screen.getByTestId('close-modal')
      await act(async () => {
        await user.click(closeButton)
      })

      expect(screen.queryByTestId('secret-key-modal')).not.toBeInTheDocument()
    })

    it('should toggle modal visibility', async () => {
      const user = userEvent.setup()
      render(<SecretKeyButton />)

      const button = screen.getByRole('button')

      await act(async () => {
        await user.click(button)
      })
      expect(screen.getByTestId('secret-key-modal')).toBeInTheDocument()

      const closeButton = screen.getByTestId('close-modal')
      await act(async () => {
        await user.click(closeButton)
      })
      expect(screen.queryByTestId('secret-key-modal')).not.toBeInTheDocument()

      await act(async () => {
        await user.click(button)
      })
      expect(screen.getByTestId('secret-key-modal')).toBeInTheDocument()
    })
  })

  describe('props', () => {
    it('should apply custom className', () => {
      render(<SecretKeyButton className="custom-class" />)
      const button = screen.getByRole('button')
      expect(button.className).toContain('custom-class')
    })

    it('should pass appId to modal', async () => {
      const user = userEvent.setup()
      render(<SecretKeyButton appId="app-123" />)

      const button = screen.getByRole('button')
      await act(async () => {
        await user.click(button)
      })

      expect(screen.getByText('Modal for app-123')).toBeInTheDocument()
    })

    it('should handle undefined appId', async () => {
      const user = userEvent.setup()
      render(<SecretKeyButton />)

      const button = screen.getByRole('button')
      await act(async () => {
        await user.click(button)
      })

      expect(screen.getByText('Modal for no-app')).toBeInTheDocument()
    })

    it('should apply custom textCls', () => {
      render(<SecretKeyButton textCls="custom-text-class" />)
      const text = screen.getByText('appApi.apiKey')
      expect(text.className).toContain('custom-text-class')
    })
  })

  describe('button styling', () => {
    it('should have px-3 padding', () => {
      render(<SecretKeyButton />)
      const button = screen.getByRole('button')
      expect(button.className).toContain('px-3')
    })

    it('should have small size', () => {
      render(<SecretKeyButton />)
      const button = screen.getByRole('button')
      expect(button.className).toContain('btn-small')
    })

    it('should have ghost variant', () => {
      render(<SecretKeyButton />)
      const button = screen.getByRole('button')
      expect(button.className).toContain('btn-ghost')
    })
  })

  describe('icon styling', () => {
    it('should have icon container with flex layout', () => {
      const { container } = render(<SecretKeyButton />)
      const iconContainer = container.querySelector('.flex.items-center.justify-center')
      expect(iconContainer).toBeInTheDocument()
    })

    it('should have correct icon dimensions', () => {
      const { container } = render(<SecretKeyButton />)
      const iconContainer = container.querySelector('.h-3\\.5.w-3\\.5')
      expect(iconContainer).toBeInTheDocument()
    })

    it('should have tertiary text color on icon', () => {
      const { container } = render(<SecretKeyButton />)
      const icon = container.querySelector('.text-text-tertiary')
      expect(icon).toBeInTheDocument()
    })
  })

  describe('text styling', () => {
    it('should have system-xs-medium class', () => {
      render(<SecretKeyButton />)
      const text = screen.getByText('appApi.apiKey')
      expect(text.className).toContain('system-xs-medium')
    })

    it('should have horizontal padding', () => {
      render(<SecretKeyButton />)
      const text = screen.getByText('appApi.apiKey')
      expect(text.className).toContain('px-[3px]')
    })

    it('should have tertiary text color', () => {
      render(<SecretKeyButton />)
      const text = screen.getByText('appApi.apiKey')
      expect(text.className).toContain('text-text-tertiary')
    })
  })

  describe('modal props', () => {
    it('should pass isShow prop to modal', async () => {
      const user = userEvent.setup()
      render(<SecretKeyButton />)

      expect(screen.queryByTestId('secret-key-modal')).not.toBeInTheDocument()

      const button = screen.getByRole('button')
      await act(async () => {
        await user.click(button)
      })

      expect(screen.getByTestId('secret-key-modal')).toBeInTheDocument()
    })

    it('should pass onClose callback to modal', async () => {
      const user = userEvent.setup()
      render(<SecretKeyButton />)

      const button = screen.getByRole('button')
      await act(async () => {
        await user.click(button)
      })

      const closeButton = screen.getByTestId('close-modal')
      await act(async () => {
        await user.click(closeButton)
      })

      expect(screen.queryByTestId('secret-key-modal')).not.toBeInTheDocument()
    })
  })

  describe('accessibility', () => {
    it('should have accessible button', () => {
      render(<SecretKeyButton />)
      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
    })

    it('should be keyboard accessible', async () => {
      const user = userEvent.setup()
      render(<SecretKeyButton />)

      const button = screen.getByRole('button')
      button.focus()
      expect(document.activeElement).toBe(button)

      await act(async () => {
        await user.keyboard('{Enter}')
      })

      expect(screen.getByTestId('secret-key-modal')).toBeInTheDocument()
    })
  })

  describe('multiple instances', () => {
    it('should work independently when multiple instances exist', async () => {
      const user = userEvent.setup()
      render(
        <>
          <SecretKeyButton appId="app-1" />
          <SecretKeyButton appId="app-2" />
        </>,
      )

      const buttons = screen.getAllByRole('button')
      expect(buttons).toHaveLength(2)

      await act(async () => {
        await user.click(buttons[0])
      })

      expect(screen.getByText('Modal for app-1')).toBeInTheDocument()

      const closeButton = screen.getByTestId('close-modal')
      await act(async () => {
        await user.click(closeButton)
      })

      await act(async () => {
        await user.click(buttons[1])
      })

      expect(screen.getByText('Modal for app-2')).toBeInTheDocument()
    })
  })
})
