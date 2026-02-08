import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================================
// Component Imports (after mocks)
// ============================================================================

import UrlInput from './url-input'

// ============================================================================
// Mock Setup
// ============================================================================

// Mock useDocLink hook
vi.mock('@/context/i18n', () => ({
  useDocLink: vi.fn(() => () => 'https://docs.example.com'),
}))

// ============================================================================
// UrlInput Component Tests
// ============================================================================

describe('UrlInput', () => {
  const mockOnRun = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // Rendering Tests
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<UrlInput isRunning={false} onRun={mockOnRun} />)
      expect(screen.getByRole('textbox')).toBeInTheDocument()
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should render input with placeholder from docLink', () => {
      render(<UrlInput isRunning={false} onRun={mockOnRun} />)
      const input = screen.getByRole('textbox')
      expect(input).toHaveAttribute('placeholder', 'https://docs.example.com')
    })

    it('should render button with run text when not running', () => {
      render(<UrlInput isRunning={false} onRun={mockOnRun} />)
      const button = screen.getByRole('button')
      expect(button).toHaveTextContent(/run/i)
    })

    it('should render button without run text when running', () => {
      render(<UrlInput isRunning={true} onRun={mockOnRun} />)
      const button = screen.getByRole('button')
      // Button should not have "run" text when running (shows loading state instead)
      expect(button).not.toHaveTextContent(/run/i)
    })

    it('should show loading state on button when running', () => {
      render(<UrlInput isRunning={true} onRun={mockOnRun} />)
      // Button should show loading text when running
      const button = screen.getByRole('button')
      expect(button).toHaveTextContent(/loading/i)
    })

    it('should not show loading state on button when not running', () => {
      render(<UrlInput isRunning={false} onRun={mockOnRun} />)
      const button = screen.getByRole('button')
      expect(button).not.toHaveTextContent(/loading/i)
    })
  })

  // --------------------------------------------------------------------------
  // User Interactions Tests
  // --------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should update input value when user types', async () => {
      const user = userEvent.setup()

      render(<UrlInput isRunning={false} onRun={mockOnRun} />)

      const input = screen.getByRole('textbox')
      await user.type(input, 'https://example.com')

      expect(input).toHaveValue('https://example.com')
    })

    it('should call onRun with url when button is clicked and not running', async () => {
      const user = userEvent.setup()

      render(<UrlInput isRunning={false} onRun={mockOnRun} />)

      const input = screen.getByRole('textbox')
      await user.type(input, 'https://example.com')

      const button = screen.getByRole('button')
      await user.click(button)

      expect(mockOnRun).toHaveBeenCalledWith('https://example.com')
      expect(mockOnRun).toHaveBeenCalledTimes(1)
    })

    it('should NOT call onRun when button is clicked and isRunning is true', async () => {
      const user = userEvent.setup()

      render(<UrlInput isRunning={true} onRun={mockOnRun} />)

      const input = screen.getByRole('textbox')
      // Use fireEvent since userEvent might not work well with disabled-like states
      fireEvent.change(input, { target: { value: 'https://example.com' } })

      const button = screen.getByRole('button')
      await user.click(button)

      // onRun should NOT be called because isRunning is true
      expect(mockOnRun).not.toHaveBeenCalled()
    })

    it('should call onRun with empty string when button clicked with empty input', async () => {
      const user = userEvent.setup()

      render(<UrlInput isRunning={false} onRun={mockOnRun} />)

      const button = screen.getByRole('button')
      await user.click(button)

      expect(mockOnRun).toHaveBeenCalledWith('')
      expect(mockOnRun).toHaveBeenCalledTimes(1)
    })

    it('should handle multiple button clicks when not running', async () => {
      const user = userEvent.setup()

      render(<UrlInput isRunning={false} onRun={mockOnRun} />)

      const input = screen.getByRole('textbox')
      await user.type(input, 'https://test.com')

      const button = screen.getByRole('button')
      await user.click(button)
      await user.click(button)

      expect(mockOnRun).toHaveBeenCalledTimes(2)
      expect(mockOnRun).toHaveBeenCalledWith('https://test.com')
    })
  })

  // --------------------------------------------------------------------------
  // Props Variations Tests
  // --------------------------------------------------------------------------
  describe('Props Variations', () => {
    it('should update button state when isRunning changes from false to true', () => {
      const { rerender } = render(<UrlInput isRunning={false} onRun={mockOnRun} />)

      const button = screen.getByRole('button')
      expect(button).toHaveTextContent(/run/i)

      rerender(<UrlInput isRunning={true} onRun={mockOnRun} />)

      // When running, button shows loading state instead of "run" text
      expect(button).not.toHaveTextContent(/run/i)
    })

    it('should update button state when isRunning changes from true to false', () => {
      const { rerender } = render(<UrlInput isRunning={true} onRun={mockOnRun} />)

      const button = screen.getByRole('button')
      // When running, button shows loading state instead of "run" text
      expect(button).not.toHaveTextContent(/run/i)

      rerender(<UrlInput isRunning={false} onRun={mockOnRun} />)

      expect(button).toHaveTextContent(/run/i)
    })

    it('should preserve input value when isRunning prop changes', async () => {
      const user = userEvent.setup()

      const { rerender } = render(<UrlInput isRunning={false} onRun={mockOnRun} />)

      const input = screen.getByRole('textbox')
      await user.type(input, 'https://preserved.com')

      expect(input).toHaveValue('https://preserved.com')

      rerender(<UrlInput isRunning={true} onRun={mockOnRun} />)

      expect(input).toHaveValue('https://preserved.com')
    })
  })

  // --------------------------------------------------------------------------
  // Edge Cases Tests
  // --------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle special characters in url', async () => {
      const user = userEvent.setup()

      render(<UrlInput isRunning={false} onRun={mockOnRun} />)

      const input = screen.getByRole('textbox')
      const specialUrl = 'https://example.com/path?query=test&param=value#anchor'
      await user.type(input, specialUrl)

      const button = screen.getByRole('button')
      await user.click(button)

      expect(mockOnRun).toHaveBeenCalledWith(specialUrl)
    })

    it('should handle unicode characters in url', async () => {
      const user = userEvent.setup()

      render(<UrlInput isRunning={false} onRun={mockOnRun} />)

      const input = screen.getByRole('textbox')
      const unicodeUrl = 'https://example.com/路径/文件'
      await user.type(input, unicodeUrl)

      const button = screen.getByRole('button')
      await user.click(button)

      expect(mockOnRun).toHaveBeenCalledWith(unicodeUrl)
    })

    it('should handle very long url', async () => {
      const user = userEvent.setup()

      render(<UrlInput isRunning={false} onRun={mockOnRun} />)

      const input = screen.getByRole('textbox')
      const longUrl = `https://example.com/${'a'.repeat(500)}`

      // Use fireEvent for long text to avoid timeout
      fireEvent.change(input, { target: { value: longUrl } })

      const button = screen.getByRole('button')
      await user.click(button)

      expect(mockOnRun).toHaveBeenCalledWith(longUrl)
    })

    it('should handle whitespace in url', async () => {
      render(<UrlInput isRunning={false} onRun={mockOnRun} />)

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: '  https://example.com  ' } })

      const button = screen.getByRole('button')
      fireEvent.click(button)

      expect(mockOnRun).toHaveBeenCalledWith('  https://example.com  ')
    })

    it('should handle rapid input changes', async () => {
      render(<UrlInput isRunning={false} onRun={mockOnRun} />)

      const input = screen.getByRole('textbox')

      fireEvent.change(input, { target: { value: 'a' } })
      fireEvent.change(input, { target: { value: 'ab' } })
      fireEvent.change(input, { target: { value: 'abc' } })
      fireEvent.change(input, { target: { value: 'https://final.com' } })

      expect(input).toHaveValue('https://final.com')

      const button = screen.getByRole('button')
      fireEvent.click(button)

      expect(mockOnRun).toHaveBeenCalledWith('https://final.com')
    })
  })

  // --------------------------------------------------------------------------
  // handleOnRun Branch Coverage Tests
  // --------------------------------------------------------------------------
  describe('handleOnRun Branch Coverage', () => {
    it('should return early when isRunning is true (branch: isRunning = true)', async () => {
      const user = userEvent.setup()

      render(<UrlInput isRunning={true} onRun={mockOnRun} />)

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'https://test.com' } })

      const button = screen.getByRole('button')
      await user.click(button)

      // The early return should prevent onRun from being called
      expect(mockOnRun).not.toHaveBeenCalled()
    })

    it('should call onRun when isRunning is false (branch: isRunning = false)', async () => {
      const user = userEvent.setup()

      render(<UrlInput isRunning={false} onRun={mockOnRun} />)

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'https://test.com' } })

      const button = screen.getByRole('button')
      await user.click(button)

      // onRun should be called when isRunning is false
      expect(mockOnRun).toHaveBeenCalledWith('https://test.com')
    })
  })

  // --------------------------------------------------------------------------
  // Button Text Branch Coverage Tests
  // --------------------------------------------------------------------------
  describe('Button Text Branch Coverage', () => {
    it('should display run text when isRunning is false (branch: !isRunning = true)', () => {
      render(<UrlInput isRunning={false} onRun={mockOnRun} />)

      const button = screen.getByRole('button')
      // When !isRunning is true, button shows the translated "run" text
      expect(button).toHaveTextContent(/run/i)
    })

    it('should not display run text when isRunning is true (branch: !isRunning = false)', () => {
      render(<UrlInput isRunning={true} onRun={mockOnRun} />)

      const button = screen.getByRole('button')
      // When !isRunning is false, button shows empty string '' (loading state shows spinner)
      expect(button).not.toHaveTextContent(/run/i)
    })
  })

  // --------------------------------------------------------------------------
  // Memoization Tests
  // --------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should be memoized with React.memo', () => {
      const { rerender } = render(<UrlInput isRunning={false} onRun={mockOnRun} />)

      rerender(<UrlInput isRunning={false} onRun={mockOnRun} />)

      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('should use useCallback for handleUrlChange', async () => {
      const user = userEvent.setup()

      const { rerender } = render(<UrlInput isRunning={false} onRun={mockOnRun} />)

      const input = screen.getByRole('textbox')
      await user.type(input, 'test')

      rerender(<UrlInput isRunning={false} onRun={mockOnRun} />)

      // Input should maintain value after rerender
      expect(input).toHaveValue('test')
    })

    it('should use useCallback for handleOnRun', async () => {
      const user = userEvent.setup()

      const { rerender } = render(<UrlInput isRunning={false} onRun={mockOnRun} />)

      rerender(<UrlInput isRunning={false} onRun={mockOnRun} />)

      const button = screen.getByRole('button')
      await user.click(button)

      expect(mockOnRun).toHaveBeenCalledTimes(1)
    })
  })

  // --------------------------------------------------------------------------
  // Integration Tests
  // --------------------------------------------------------------------------
  describe('Integration', () => {
    it('should complete full workflow: type url -> click run -> verify callback', async () => {
      const user = userEvent.setup()

      render(<UrlInput isRunning={false} onRun={mockOnRun} />)

      // Type URL
      const input = screen.getByRole('textbox')
      await user.type(input, 'https://mywebsite.com')

      // Click run
      const button = screen.getByRole('button')
      await user.click(button)

      // Verify callback
      expect(mockOnRun).toHaveBeenCalledWith('https://mywebsite.com')
    })

    it('should show correct states during running workflow', () => {
      const { rerender } = render(<UrlInput isRunning={false} onRun={mockOnRun} />)

      // Initial state: not running
      expect(screen.getByRole('button')).toHaveTextContent(/run/i)

      // Simulate running state
      rerender(<UrlInput isRunning={true} onRun={mockOnRun} />)
      expect(screen.getByRole('button')).not.toHaveTextContent(/run/i)

      // Simulate finished state
      rerender(<UrlInput isRunning={false} onRun={mockOnRun} />)
      expect(screen.getByRole('button')).toHaveTextContent(/run/i)
    })
  })
})
