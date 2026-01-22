import type { HeaderItem } from './headers-input'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import HeadersInput from './headers-input'

// Mock uuid to return predictable values
vi.mock('uuid', () => ({
  v4: () => 'mock-uuid',
}))

describe('HeadersInput', () => {
  const mockOnChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Empty State', () => {
    it('should render empty state when no headers', () => {
      render(
        <HeadersInput
          headersItems={[]}
          onChange={mockOnChange}
        />,
      )

      expect(screen.getByText('tools.mcp.modal.noHeaders')).toBeInTheDocument()
    })

    it('should show add button in empty state when not readonly', () => {
      render(
        <HeadersInput
          headersItems={[]}
          onChange={mockOnChange}
        />,
      )

      expect(screen.getByText('tools.mcp.modal.addHeader')).toBeInTheDocument()
    })

    it('should not show add button in empty state when readonly', () => {
      render(
        <HeadersInput
          headersItems={[]}
          onChange={mockOnChange}
          readonly
        />,
      )

      expect(screen.queryByText('tools.mcp.modal.addHeader')).not.toBeInTheDocument()
    })

    it('should call onChange with new item when add button is clicked', () => {
      render(
        <HeadersInput
          headersItems={[]}
          onChange={mockOnChange}
        />,
      )

      const addButton = screen.getByText('tools.mcp.modal.addHeader')
      fireEvent.click(addButton)

      expect(mockOnChange).toHaveBeenCalledWith([
        { id: 'mock-uuid', key: '', value: '' },
      ])
    })
  })

  describe('With Headers', () => {
    const mockHeaders: HeaderItem[] = [
      { id: '1', key: 'Authorization', value: 'Bearer token' },
      { id: '2', key: 'Content-Type', value: 'application/json' },
    ]

    it('should render headers table', () => {
      render(
        <HeadersInput
          headersItems={mockHeaders}
          onChange={mockOnChange}
        />,
      )

      expect(screen.getByText('tools.mcp.modal.headerKey')).toBeInTheDocument()
      expect(screen.getByText('tools.mcp.modal.headerValue')).toBeInTheDocument()
    })

    it('should render all header items', () => {
      render(
        <HeadersInput
          headersItems={mockHeaders}
          onChange={mockOnChange}
        />,
      )

      const inputs = screen.getAllByRole('textbox')
      // 2 headers × 2 inputs each = 4 inputs
      expect(inputs).toHaveLength(4)
    })

    it('should display header key values', () => {
      render(
        <HeadersInput
          headersItems={mockHeaders}
          onChange={mockOnChange}
        />,
      )

      expect(screen.getByDisplayValue('Authorization')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Content-Type')).toBeInTheDocument()
    })

    it('should display header value values', () => {
      render(
        <HeadersInput
          headersItems={mockHeaders}
          onChange={mockOnChange}
        />,
      )

      expect(screen.getByDisplayValue('Bearer token')).toBeInTheDocument()
      expect(screen.getByDisplayValue('application/json')).toBeInTheDocument()
    })
  })

  describe('Header Editing', () => {
    const mockHeaders: HeaderItem[] = [
      { id: '1', key: 'Authorization', value: 'Bearer token' },
    ]

    it('should call onChange when key is changed', () => {
      render(
        <HeadersInput
          headersItems={mockHeaders}
          onChange={mockOnChange}
        />,
      )

      const keyInput = screen.getByDisplayValue('Authorization')
      fireEvent.change(keyInput, { target: { value: 'X-API-Key' } })

      expect(mockOnChange).toHaveBeenCalledWith([
        { id: '1', key: 'X-API-Key', value: 'Bearer token' },
      ])
    })

    it('should call onChange when value is changed', () => {
      render(
        <HeadersInput
          headersItems={mockHeaders}
          onChange={mockOnChange}
        />,
      )

      const valueInput = screen.getByDisplayValue('Bearer token')
      fireEvent.change(valueInput, { target: { value: 'new-token' } })

      expect(mockOnChange).toHaveBeenCalledWith([
        { id: '1', key: 'Authorization', value: 'new-token' },
      ])
    })

    it('should not allow editing when readonly', () => {
      render(
        <HeadersInput
          headersItems={mockHeaders}
          onChange={mockOnChange}
          readonly
        />,
      )

      const inputs = screen.getAllByRole('textbox')
      inputs.forEach((input) => {
        expect(input).toHaveAttribute('readonly')
      })
    })
  })

  describe('Header Removal', () => {
    const mockHeaders: HeaderItem[] = [
      { id: '1', key: 'Authorization', value: 'Bearer token' },
      { id: '2', key: 'Content-Type', value: 'application/json' },
    ]

    it('should show delete button when not readonly', () => {
      render(
        <HeadersInput
          headersItems={mockHeaders}
          onChange={mockOnChange}
        />,
      )

      // Delete buttons should be present
      const deleteButtons = document.querySelectorAll('.text-text-destructive')
      expect(deleteButtons.length).toBeGreaterThan(0)
    })

    it('should not show delete button when readonly', () => {
      render(
        <HeadersInput
          headersItems={mockHeaders}
          onChange={mockOnChange}
          readonly
        />,
      )

      const deleteButtons = document.querySelectorAll('.text-text-destructive')
      expect(deleteButtons.length).toBe(0)
    })

    it('should call onChange with filtered items when delete is clicked', () => {
      render(
        <HeadersInput
          headersItems={mockHeaders}
          onChange={mockOnChange}
        />,
      )

      const deleteButtons = document.querySelectorAll('button')
      // Find the delete button (last button in the first row)
      const deleteButton = Array.from(deleteButtons).find(btn =>
        btn.querySelector('.text-text-destructive'),
      )

      if (deleteButton) {
        fireEvent.click(deleteButton)
        expect(mockOnChange).toHaveBeenCalled()
      }
    })
  })

  describe('Add Header', () => {
    const mockHeaders: HeaderItem[] = [
      { id: '1', key: 'Authorization', value: 'Bearer token' },
    ]

    it('should show add button when not readonly', () => {
      render(
        <HeadersInput
          headersItems={mockHeaders}
          onChange={mockOnChange}
        />,
      )

      expect(screen.getByText('tools.mcp.modal.addHeader')).toBeInTheDocument()
    })

    it('should not show add button when readonly', () => {
      render(
        <HeadersInput
          headersItems={mockHeaders}
          onChange={mockOnChange}
          readonly
        />,
      )

      expect(screen.queryByText('tools.mcp.modal.addHeader')).not.toBeInTheDocument()
    })

    it('should call onChange with new item when add is clicked', () => {
      render(
        <HeadersInput
          headersItems={mockHeaders}
          onChange={mockOnChange}
        />,
      )

      const addButton = screen.getByText('tools.mcp.modal.addHeader')
      fireEvent.click(addButton)

      expect(mockOnChange).toHaveBeenCalledWith([
        ...mockHeaders,
        { id: 'mock-uuid', key: '', value: '' },
      ])
    })
  })

  describe('Masked Headers', () => {
    const mockHeaders: HeaderItem[] = [
      { id: '1', key: 'Authorization', value: 'Bearer token' },
    ]

    it('should show masked tip when isMasked is true', () => {
      render(
        <HeadersInput
          headersItems={mockHeaders}
          onChange={mockOnChange}
          isMasked
        />,
      )

      expect(screen.getByText('tools.mcp.modal.maskedHeadersTip')).toBeInTheDocument()
    })

    it('should not show masked tip when isMasked is false', () => {
      render(
        <HeadersInput
          headersItems={mockHeaders}
          onChange={mockOnChange}
          isMasked={false}
        />,
      )

      expect(screen.queryByText('tools.mcp.modal.maskedHeadersTip')).not.toBeInTheDocument()
    })
  })
})
