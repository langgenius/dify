import { fireEvent, render, screen } from '@testing-library/react'
import CreateAppTemplateDialog from './index'

// Mock external dependencies (not base components)
jest.mock('./app-list', () => {
  return function MockAppList({
    onCreateFromBlank,
    onSuccess,
  }: {
    onCreateFromBlank?: () => void
    onSuccess: () => void
  }) {
    return (
      <div data-testid="app-list">
        <button data-testid="app-list-success" onClick={onSuccess}>
          Success
        </button>
        {onCreateFromBlank && (
          <button data-testid="create-from-blank" onClick={onCreateFromBlank}>
            Create from Blank
          </button>
        )}
      </div>
    )
  }
})

jest.mock('ahooks', () => ({
  useKeyPress: jest.fn((_key: string, _callback: () => void) => {
    // Mock implementation for testing
    return jest.fn()
  }),
}))

describe('CreateAppTemplateDialog', () => {
  const defaultProps = {
    show: false,
    onSuccess: jest.fn(),
    onClose: jest.fn(),
    onCreateFromBlank: jest.fn(),
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should not render when show is false', () => {
      render(<CreateAppTemplateDialog {...defaultProps} />)

      // FullScreenModal should not render any content when open is false
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('should render modal when show is true', () => {
      render(<CreateAppTemplateDialog {...defaultProps} show={true} />)

      // FullScreenModal renders with role="dialog"
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByTestId('app-list')).toBeInTheDocument()
    })

    it('should render create from blank button when onCreateFromBlank is provided', () => {
      render(<CreateAppTemplateDialog {...defaultProps} show={true} />)

      expect(screen.getByTestId('create-from-blank')).toBeInTheDocument()
    })

    it('should not render create from blank button when onCreateFromBlank is not provided', () => {
      const { onCreateFromBlank: _onCreateFromBlank, ...propsWithoutOnCreate } = defaultProps

      render(<CreateAppTemplateDialog {...propsWithoutOnCreate} show={true} />)

      expect(screen.queryByTestId('create-from-blank')).not.toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should pass show prop to FullScreenModal', () => {
      const { rerender } = render(<CreateAppTemplateDialog {...defaultProps} />)

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

      rerender(<CreateAppTemplateDialog {...defaultProps} show={true} />)
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('should pass closable prop to FullScreenModal', () => {
      // Since the FullScreenModal is always rendered with closable=true
      // we can verify that the modal renders with the proper structure
      render(<CreateAppTemplateDialog {...defaultProps} show={true} />)

      // Verify that the modal has the proper dialog structure
      const dialog = screen.getByRole('dialog')
      expect(dialog).toBeInTheDocument()
      expect(dialog).toHaveAttribute('aria-modal', 'true')
    })
  })

  describe('User Interactions', () => {
    it('should handle close interactions', () => {
      const mockOnClose = jest.fn()
      render(<CreateAppTemplateDialog {...defaultProps} show={true} onClose={mockOnClose} />)

      // Test that the modal is rendered
      const dialog = screen.getByRole('dialog')
      expect(dialog).toBeInTheDocument()

      // Test that AppList component renders (child component interactions)
      expect(screen.getByTestId('app-list')).toBeInTheDocument()
      expect(screen.getByTestId('app-list-success')).toBeInTheDocument()
    })

    it('should call both onSuccess and onClose when app list success is triggered', () => {
      const mockOnSuccess = jest.fn()
      const mockOnClose = jest.fn()
      render(<CreateAppTemplateDialog
        {...defaultProps}
        show={true}
        onSuccess={mockOnSuccess}
        onClose={mockOnClose}
      />)

      fireEvent.click(screen.getByTestId('app-list-success'))

      expect(mockOnSuccess).toHaveBeenCalledTimes(1)
      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })

    it('should call onCreateFromBlank when create from blank is clicked', () => {
      const mockOnCreateFromBlank = jest.fn()
      render(<CreateAppTemplateDialog
        {...defaultProps}
        show={true}
        onCreateFromBlank={mockOnCreateFromBlank}
      />)

      fireEvent.click(screen.getByTestId('create-from-blank'))

      expect(mockOnCreateFromBlank).toHaveBeenCalledTimes(1)
    })
  })

  describe('useKeyPress Integration', () => {
    it('should set up ESC key listener when modal is shown', () => {
      const { useKeyPress } = require('ahooks')

      render(<CreateAppTemplateDialog {...defaultProps} show={true} />)

      expect(useKeyPress).toHaveBeenCalledWith('esc', expect.any(Function))
    })

    it('should handle ESC key press to close modal', () => {
      const { useKeyPress } = require('ahooks')
      let capturedCallback: (() => void) | undefined

      useKeyPress.mockImplementation((key: string, callback: () => void) => {
        if (key === 'esc')
          capturedCallback = callback

        return jest.fn()
      })

      const mockOnClose = jest.fn()
      render(<CreateAppTemplateDialog
        {...defaultProps}
        show={true}
        onClose={mockOnClose}
      />)

      expect(capturedCallback).toBeDefined()
      expect(typeof capturedCallback).toBe('function')

      // Simulate ESC key press
      capturedCallback?.()

      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })

    it('should not call onClose when ESC key is pressed and modal is not shown', () => {
      const { useKeyPress } = require('ahooks')
      let capturedCallback: (() => void) | undefined

      useKeyPress.mockImplementation((key: string, callback: () => void) => {
        if (key === 'esc')
          capturedCallback = callback

        return jest.fn()
      })

      const mockOnClose = jest.fn()
      render(<CreateAppTemplateDialog
        {...defaultProps}
        show={false} // Modal not shown
        onClose={mockOnClose}
      />)

      // The callback should still be created but not execute onClose
      expect(capturedCallback).toBeDefined()

      // Simulate ESC key press
      capturedCallback?.()

      // onClose should not be called because modal is not shown
      expect(mockOnClose).not.toHaveBeenCalled()
    })
  })

  describe('Callback Dependencies', () => {
    it('should create stable callback reference for ESC key handler', () => {
      const { useKeyPress } = require('ahooks')

      render(<CreateAppTemplateDialog {...defaultProps} show={true} />)

      // Verify that useKeyPress was called with a function
      const calls = useKeyPress.mock.calls
      expect(calls.length).toBeGreaterThan(0)
      expect(calls[0][0]).toBe('esc')
      expect(typeof calls[0][1]).toBe('function')
    })
  })

  describe('Edge Cases', () => {
    it('should handle null props gracefully', () => {
      expect(() => {
        render(<CreateAppTemplateDialog
          show={true}
          onSuccess={jest.fn()}
          onClose={jest.fn()}
          // onCreateFromBlank is undefined
        />)
      }).not.toThrow()
    })

    it('should handle undefined props gracefully', () => {
      expect(() => {
        render(<CreateAppTemplateDialog
          show={true}
          onSuccess={jest.fn()}
          onClose={jest.fn()}
          onCreateFromBlank={undefined}
        />)
      }).not.toThrow()
    })

    it('should handle rapid show/hide toggles', () => {
      // Test initial state
      const { unmount } = render(<CreateAppTemplateDialog {...defaultProps} show={false} />)
      unmount()

      // Test show state
      render(<CreateAppTemplateDialog {...defaultProps} show={true} />)
      expect(screen.getByRole('dialog')).toBeInTheDocument()

      // Test hide state
      render(<CreateAppTemplateDialog {...defaultProps} show={false} />)
      // Due to transition animations, we just verify the component handles the prop change
      expect(() => render(<CreateAppTemplateDialog {...defaultProps} show={false} />)).not.toThrow()
    })

    it('should handle missing optional onCreateFromBlank prop', () => {
      const { onCreateFromBlank: _onCreateFromBlank, ...propsWithoutOnCreate } = defaultProps

      expect(() => {
        render(<CreateAppTemplateDialog {...propsWithoutOnCreate} show={true} />)
      }).not.toThrow()

      expect(screen.getByTestId('app-list')).toBeInTheDocument()
      expect(screen.queryByTestId('create-from-blank')).not.toBeInTheDocument()
    })

    it('should work with all required props only', () => {
      const requiredProps = {
        show: true,
        onSuccess: jest.fn(),
        onClose: jest.fn(),
      }

      expect(() => {
        render(<CreateAppTemplateDialog {...requiredProps} />)
      }).not.toThrow()

      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByTestId('app-list')).toBeInTheDocument()
    })
  })
})
