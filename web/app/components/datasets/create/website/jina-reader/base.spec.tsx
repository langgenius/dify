import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UrlInput from './base/url-input'

// Mock doc link context
vi.mock('@/context/i18n', () => ({
  useDocLink: () => () => 'https://docs.example.com',
}))

// ============================================================================
// UrlInput Component Tests
// ============================================================================

describe('UrlInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Helper to create default props for UrlInput
  const createUrlInputProps = (overrides: Partial<Parameters<typeof UrlInput>[0]> = {}) => ({
    isRunning: false,
    onRun: vi.fn(),
    ...overrides,
  })

  // --------------------------------------------------------------------------
  // Rendering Tests
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange
      const props = createUrlInputProps()

      // Act
      render(<UrlInput {...props} />)

      // Assert
      expect(screen.getByRole('textbox')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /run/i })).toBeInTheDocument()
    })

    it('should render input with placeholder from docLink', () => {
      // Arrange
      const props = createUrlInputProps()

      // Act
      render(<UrlInput {...props} />)

      // Assert
      const input = screen.getByRole('textbox')
      expect(input).toHaveAttribute('placeholder', 'https://docs.example.com')
    })

    it('should render run button with correct text when not running', () => {
      // Arrange
      const props = createUrlInputProps({ isRunning: false })

      // Act
      render(<UrlInput {...props} />)

      // Assert
      expect(screen.getByRole('button', { name: /run/i })).toBeInTheDocument()
    })

    it('should render button without text when running', () => {
      // Arrange
      const props = createUrlInputProps({ isRunning: true })

      // Act
      render(<UrlInput {...props} />)

      // Assert - find button by data-testid when in loading state
      const runButton = screen.getByTestId('url-input-run-button')
      expect(runButton).toBeInTheDocument()
      // Button text should be empty when running
      expect(runButton).not.toHaveTextContent(/run/i)
    })

    it('should show loading state on button when running', () => {
      // Arrange
      const onRun = vi.fn()
      const props = createUrlInputProps({ isRunning: true, onRun })

      // Act
      render(<UrlInput {...props} />)

      // Assert - find button by data-testid when in loading state
      const runButton = screen.getByTestId('url-input-run-button')
      expect(runButton).toBeInTheDocument()

      // Verify button is empty (loading state removes text)
      expect(runButton).not.toHaveTextContent(/run/i)

      // Verify clicking doesn't trigger onRun when loading
      fireEvent.click(runButton)
      expect(onRun).not.toHaveBeenCalled()
    })
  })

  // --------------------------------------------------------------------------
  // User Input Tests
  // --------------------------------------------------------------------------
  describe('User Input', () => {
    it('should update URL value when user types', async () => {
      // Arrange
      const props = createUrlInputProps()

      // Act
      render(<UrlInput {...props} />)
      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'https://test.com')

      // Assert
      expect(input).toHaveValue('https://test.com')
    })

    it('should handle URL input clearing', async () => {
      // Arrange
      const props = createUrlInputProps()

      // Act
      render(<UrlInput {...props} />)
      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'https://test.com')
      await userEvent.clear(input)

      // Assert
      expect(input).toHaveValue('')
    })

    it('should handle special characters in URL', async () => {
      // Arrange
      const props = createUrlInputProps()

      // Act
      render(<UrlInput {...props} />)
      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'https://example.com/path?query=value&foo=bar')

      // Assert
      expect(input).toHaveValue('https://example.com/path?query=value&foo=bar')
    })
  })

  // --------------------------------------------------------------------------
  // Button Click Tests
  // --------------------------------------------------------------------------
  describe('Button Click', () => {
    it('should call onRun with URL when button is clicked', async () => {
      // Arrange
      const onRun = vi.fn()
      const props = createUrlInputProps({ onRun })

      // Act
      render(<UrlInput {...props} />)
      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'https://run-test.com')
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      // Assert
      expect(onRun).toHaveBeenCalledWith('https://run-test.com')
      expect(onRun).toHaveBeenCalledTimes(1)
    })

    it('should call onRun with empty string if no URL entered', async () => {
      // Arrange
      const onRun = vi.fn()
      const props = createUrlInputProps({ onRun })

      // Act
      render(<UrlInput {...props} />)
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      // Assert
      expect(onRun).toHaveBeenCalledWith('')
    })

    it('should not call onRun when isRunning is true', async () => {
      // Arrange
      const onRun = vi.fn()
      const props = createUrlInputProps({ onRun, isRunning: true })

      // Act
      render(<UrlInput {...props} />)
      const runButton = screen.getByTestId('url-input-run-button')
      fireEvent.click(runButton)

      // Assert
      expect(onRun).not.toHaveBeenCalled()
    })

    it('should not call onRun when already running', async () => {
      // Arrange
      const onRun = vi.fn()

      // First render with isRunning=false, type URL, then rerender with isRunning=true
      const { rerender } = render(<UrlInput isRunning={false} onRun={onRun} />)
      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'https://test.com')

      // Rerender with isRunning=true to simulate a running state
      rerender(<UrlInput isRunning={true} onRun={onRun} />)

      // Find and click the button by data-testid (loading state has no text)
      const runButton = screen.getByTestId('url-input-run-button')
      fireEvent.click(runButton)

      // Assert - onRun should not be called due to early return at line 28
      expect(onRun).not.toHaveBeenCalled()
    })

    it('should prevent multiple clicks when already running', async () => {
      // Arrange
      const onRun = vi.fn()
      const props = createUrlInputProps({ onRun, isRunning: true })

      // Act
      render(<UrlInput {...props} />)
      const runButton = screen.getByTestId('url-input-run-button')
      fireEvent.click(runButton)
      fireEvent.click(runButton)
      fireEvent.click(runButton)

      // Assert
      expect(onRun).not.toHaveBeenCalled()
    })
  })

  // --------------------------------------------------------------------------
  // Props Tests
  // --------------------------------------------------------------------------
  describe('Props', () => {
    it('should respond to isRunning prop change', () => {
      // Arrange
      const props = createUrlInputProps({ isRunning: false })

      // Act
      const { rerender } = render(<UrlInput {...props} />)
      expect(screen.getByRole('button', { name: /run/i })).toBeInTheDocument()

      // Change isRunning to true
      rerender(<UrlInput {...props} isRunning={true} />)

      // Assert - find button by data-testid and verify it's now in loading state
      const runButton = screen.getByTestId('url-input-run-button')
      expect(runButton).toBeInTheDocument()
      // When loading, the button text should be empty
      expect(runButton).not.toHaveTextContent(/run/i)
    })

    it('should call updated onRun callback after prop change', async () => {
      // Arrange
      const onRun1 = vi.fn()
      const onRun2 = vi.fn()

      // Act
      const { rerender } = render(<UrlInput isRunning={false} onRun={onRun1} />)
      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'https://first.com')

      // Change onRun callback
      rerender(<UrlInput isRunning={false} onRun={onRun2} />)
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      // Assert - new callback should be called
      expect(onRun1).not.toHaveBeenCalled()
      expect(onRun2).toHaveBeenCalledWith('https://first.com')
    })
  })

  // --------------------------------------------------------------------------
  // Callback Stability Tests
  // --------------------------------------------------------------------------
  describe('Callback Stability', () => {
    it('should use memoized handleUrlChange callback', async () => {
      // Arrange
      const props = createUrlInputProps()

      // Act
      const { rerender } = render(<UrlInput {...props} />)
      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'a')

      // Rerender with same props
      rerender(<UrlInput {...props} />)
      await userEvent.type(input, 'b')

      // Assert - input should work correctly across rerenders
      expect(input).toHaveValue('ab')
    })

    it('should maintain URL state across rerenders', async () => {
      // Arrange
      const props = createUrlInputProps()

      // Act
      const { rerender } = render(<UrlInput {...props} />)
      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'https://stable.com')

      // Rerender
      rerender(<UrlInput {...props} />)

      // Assert - URL should be maintained
      expect(input).toHaveValue('https://stable.com')
    })
  })

  // --------------------------------------------------------------------------
  // Component Memoization Tests
  // --------------------------------------------------------------------------
  describe('Component Memoization', () => {
    it('should be wrapped with React.memo', () => {
      // Assert
      expect(UrlInput.$$typeof).toBeDefined()
    })
  })

  // --------------------------------------------------------------------------
  // Edge Cases Tests
  // --------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle very long URLs', async () => {
      // Arrange
      const props = createUrlInputProps()
      const longUrl = `https://example.com/${'a'.repeat(1000)}`

      // Act
      render(<UrlInput {...props} />)
      const input = screen.getByRole('textbox')
      await userEvent.type(input, longUrl)

      // Assert
      expect(input).toHaveValue(longUrl)
    })

    it('should handle URLs with unicode characters', async () => {
      // Arrange
      const props = createUrlInputProps()
      const unicodeUrl = 'https://example.com/路径/测试'

      // Act
      render(<UrlInput {...props} />)
      const input = screen.getByRole('textbox')
      await userEvent.type(input, unicodeUrl)

      // Assert
      expect(input).toHaveValue(unicodeUrl)
    })

    it('should handle rapid typing', async () => {
      // Arrange
      const props = createUrlInputProps()

      // Act
      render(<UrlInput {...props} />)
      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'https://rapid.com', { delay: 1 })

      // Assert
      expect(input).toHaveValue('https://rapid.com')
    })

    it('should handle keyboard enter to trigger run', async () => {
      // Arrange - Note: This tests if the button can be activated via keyboard
      const onRun = vi.fn()
      const props = createUrlInputProps({ onRun })

      // Act
      render(<UrlInput {...props} />)
      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'https://enter.com')

      // Focus button and press enter
      const button = screen.getByRole('button', { name: /run/i })
      button.focus()
      await userEvent.keyboard('{Enter}')

      // Assert
      expect(onRun).toHaveBeenCalledWith('https://enter.com')
    })

    it('should handle empty URL submission', async () => {
      // Arrange
      const onRun = vi.fn()
      const props = createUrlInputProps({ onRun })

      // Act
      render(<UrlInput {...props} />)
      await userEvent.click(screen.getByRole('button', { name: /run/i }))

      // Assert - should call with empty string
      expect(onRun).toHaveBeenCalledWith('')
    })
  })
})
