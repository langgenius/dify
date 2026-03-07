import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Component Imports (after mocks)

import UrlInput from '../url-input'

// Mock Setup

vi.mock('@/context/i18n', () => ({
  useDocLink: vi.fn(() => () => 'https://docs.example.com'),
}))

// Jina Reader UrlInput Component Tests

describe('UrlInput (jina-reader)', () => {
  const mockOnRun = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render input and run button', () => {
      render(<UrlInput isRunning={false} onRun={mockOnRun} />)
      expect(screen.getByRole('textbox')).toBeInTheDocument()
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should render input with placeholder from docLink', () => {
      render(<UrlInput isRunning={false} onRun={mockOnRun} />)
      const input = screen.getByRole('textbox')
      expect(input).toHaveAttribute('placeholder', 'https://docs.example.com')
    })

    it('should show run text when not running', () => {
      render(<UrlInput isRunning={false} onRun={mockOnRun} />)
      const button = screen.getByRole('button')
      expect(button).toHaveTextContent(/run/i)
    })

    it('should hide run text when running', () => {
      render(<UrlInput isRunning={true} onRun={mockOnRun} />)
      const button = screen.getByRole('button')
      expect(button).not.toHaveTextContent(/run/i)
    })

    it('should show loading state on button when running', () => {
      render(<UrlInput isRunning={true} onRun={mockOnRun} />)
      const button = screen.getByRole('button')
      expect(button).toHaveTextContent(/loading/i)
    })

    it('should not show loading state on button when not running', () => {
      render(<UrlInput isRunning={false} onRun={mockOnRun} />)
      const button = screen.getByRole('button')
      expect(button).not.toHaveTextContent(/loading/i)
    })
  })

  describe('User Interactions', () => {
    it('should update url when user types in input', async () => {
      const user = userEvent.setup()
      render(<UrlInput isRunning={false} onRun={mockOnRun} />)

      const input = screen.getByRole('textbox')
      await user.type(input, 'https://example.com')

      expect(input).toHaveValue('https://example.com')
    })

    it('should call onRun with url when run button clicked and not running', async () => {
      const user = userEvent.setup()
      render(<UrlInput isRunning={false} onRun={mockOnRun} />)

      const input = screen.getByRole('textbox')
      await user.type(input, 'https://example.com')

      const button = screen.getByRole('button')
      await user.click(button)

      expect(mockOnRun).toHaveBeenCalledWith('https://example.com')
      expect(mockOnRun).toHaveBeenCalledTimes(1)
    })

    it('should NOT call onRun when isRunning is true', async () => {
      const user = userEvent.setup()
      render(<UrlInput isRunning={true} onRun={mockOnRun} />)

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'https://example.com' } })

      const button = screen.getByRole('button')
      await user.click(button)

      expect(mockOnRun).not.toHaveBeenCalled()
    })

    it('should call onRun with empty string when button clicked with empty input', async () => {
      const user = userEvent.setup()
      render(<UrlInput isRunning={false} onRun={mockOnRun} />)

      const button = screen.getByRole('button')
      await user.click(button)

      expect(mockOnRun).toHaveBeenCalledWith('')
    })
  })

  // Props Variations Tests
  describe('Props Variations', () => {
    it('should update button state when isRunning changes from false to true', () => {
      const { rerender } = render(<UrlInput isRunning={false} onRun={mockOnRun} />)

      expect(screen.getByRole('button')).toHaveTextContent(/run/i)

      rerender(<UrlInput isRunning={true} onRun={mockOnRun} />)

      expect(screen.getByRole('button')).not.toHaveTextContent(/run/i)
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

    it('should handle rapid input changes', () => {
      render(<UrlInput isRunning={false} onRun={mockOnRun} />)

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'a' } })
      fireEvent.change(input, { target: { value: 'ab' } })
      fireEvent.change(input, { target: { value: 'https://final.com' } })

      expect(input).toHaveValue('https://final.com')

      fireEvent.click(screen.getByRole('button'))
      expect(mockOnRun).toHaveBeenCalledWith('https://final.com')
    })
  })

  describe('Integration', () => {
    it('should complete full workflow: type url -> click run -> verify callback', async () => {
      const user = userEvent.setup()
      render(<UrlInput isRunning={false} onRun={mockOnRun} />)

      const input = screen.getByRole('textbox')
      await user.type(input, 'https://mywebsite.com')

      const button = screen.getByRole('button')
      await user.click(button)

      expect(mockOnRun).toHaveBeenCalledWith('https://mywebsite.com')
    })

    it('should show correct states during running workflow', () => {
      const { rerender } = render(<UrlInput isRunning={false} onRun={mockOnRun} />)

      expect(screen.getByRole('button')).toHaveTextContent(/run/i)

      rerender(<UrlInput isRunning={true} onRun={mockOnRun} />)
      expect(screen.getByRole('button')).not.toHaveTextContent(/run/i)

      rerender(<UrlInput isRunning={false} onRun={mockOnRun} />)
      expect(screen.getByRole('button')).toHaveTextContent(/run/i)
    })
  })
})
