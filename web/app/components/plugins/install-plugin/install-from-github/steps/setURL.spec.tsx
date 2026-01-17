import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SetURL from './setURL'

describe('SetURL', () => {
  const defaultProps = {
    repoUrl: '',
    onChange: vi.fn(),
    onNext: vi.fn(),
    onCancel: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ================================
  // Rendering Tests
  // ================================
  describe('Rendering', () => {
    it('should render label with GitHub repo text', () => {
      render(<SetURL {...defaultProps} />)

      expect(screen.getByText('plugin.installFromGitHub.gitHubRepo')).toBeInTheDocument()
    })

    it('should render input field with correct attributes', () => {
      render(<SetURL {...defaultProps} />)

      const input = screen.getByRole('textbox')
      expect(input).toBeInTheDocument()
      expect(input).toHaveAttribute('type', 'url')
      expect(input).toHaveAttribute('id', 'repoUrl')
      expect(input).toHaveAttribute('name', 'repoUrl')
      expect(input).toHaveAttribute('placeholder', 'Please enter GitHub repo URL')
    })

    it('should render cancel button', () => {
      render(<SetURL {...defaultProps} />)

      expect(screen.getByRole('button', { name: 'plugin.installModal.cancel' })).toBeInTheDocument()
    })

    it('should render next button', () => {
      render(<SetURL {...defaultProps} />)

      expect(screen.getByRole('button', { name: 'plugin.installModal.next' })).toBeInTheDocument()
    })

    it('should associate label with input field', () => {
      render(<SetURL {...defaultProps} />)

      const input = screen.getByLabelText('plugin.installFromGitHub.gitHubRepo')
      expect(input).toBeInTheDocument()
    })
  })

  // ================================
  // Props Tests
  // ================================
  describe('Props', () => {
    it('should display repoUrl value in input', () => {
      render(<SetURL {...defaultProps} repoUrl="https://github.com/test/repo" />)

      expect(screen.getByRole('textbox')).toHaveValue('https://github.com/test/repo')
    })

    it('should display empty string when repoUrl is empty', () => {
      render(<SetURL {...defaultProps} repoUrl="" />)

      expect(screen.getByRole('textbox')).toHaveValue('')
    })
  })

  // ================================
  // User Interactions Tests
  // ================================
  describe('User Interactions', () => {
    it('should call onChange when input value changes', () => {
      const onChange = vi.fn()
      render(<SetURL {...defaultProps} onChange={onChange} />)

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'https://github.com/owner/repo' } })

      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith('https://github.com/owner/repo')
    })

    it('should call onCancel when cancel button is clicked', () => {
      const onCancel = vi.fn()
      render(<SetURL {...defaultProps} onCancel={onCancel} />)

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.cancel' }))

      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('should call onNext when next button is clicked', () => {
      const onNext = vi.fn()
      render(<SetURL {...defaultProps} repoUrl="https://github.com/test/repo" onNext={onNext} />)

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.next' }))

      expect(onNext).toHaveBeenCalledTimes(1)
    })
  })

  // ================================
  // Button State Tests
  // ================================
  describe('Button State', () => {
    it('should disable next button when repoUrl is empty', () => {
      render(<SetURL {...defaultProps} repoUrl="" />)

      expect(screen.getByRole('button', { name: 'plugin.installModal.next' })).toBeDisabled()
    })

    it('should disable next button when repoUrl is only whitespace', () => {
      render(<SetURL {...defaultProps} repoUrl="   " />)

      expect(screen.getByRole('button', { name: 'plugin.installModal.next' })).toBeDisabled()
    })

    it('should enable next button when repoUrl has content', () => {
      render(<SetURL {...defaultProps} repoUrl="https://github.com/test/repo" />)

      expect(screen.getByRole('button', { name: 'plugin.installModal.next' })).not.toBeDisabled()
    })

    it('should not disable cancel button regardless of repoUrl', () => {
      render(<SetURL {...defaultProps} repoUrl="" />)

      expect(screen.getByRole('button', { name: 'plugin.installModal.cancel' })).not.toBeDisabled()
    })
  })

  // ================================
  // Edge Cases Tests
  // ================================
  describe('Edge Cases', () => {
    it('should handle URL with special characters', () => {
      const onChange = vi.fn()
      render(<SetURL {...defaultProps} onChange={onChange} />)

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'https://github.com/test-org/repo_name-123' } })

      expect(onChange).toHaveBeenCalledWith('https://github.com/test-org/repo_name-123')
    })

    it('should handle very long URLs', () => {
      const longUrl = `https://github.com/${'a'.repeat(100)}/${'b'.repeat(100)}`
      render(<SetURL {...defaultProps} repoUrl={longUrl} />)

      expect(screen.getByRole('textbox')).toHaveValue(longUrl)
    })

    it('should handle onChange with empty string', () => {
      const onChange = vi.fn()
      render(<SetURL {...defaultProps} repoUrl="some-value" onChange={onChange} />)

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: '' } })

      expect(onChange).toHaveBeenCalledWith('')
    })

    it('should preserve callback references on rerender', () => {
      const onNext = vi.fn()
      const { rerender } = render(<SetURL {...defaultProps} repoUrl="https://github.com/a/b" onNext={onNext} />)

      rerender(<SetURL {...defaultProps} repoUrl="https://github.com/a/b" onNext={onNext} />)

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.next' }))

      expect(onNext).toHaveBeenCalledTimes(1)
    })
  })
})
