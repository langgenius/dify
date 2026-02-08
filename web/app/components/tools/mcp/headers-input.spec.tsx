import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import HeadersInput from './headers-input'

describe('HeadersInput', () => {
  const defaultProps = {
    headersItems: [],
    onChange: vi.fn(),
  }

  describe('Empty State', () => {
    it('should render no headers message when empty', () => {
      render(<HeadersInput {...defaultProps} />)
      expect(screen.getByText('tools.mcp.modal.noHeaders')).toBeInTheDocument()
    })

    it('should render add header button when empty and not readonly', () => {
      render(<HeadersInput {...defaultProps} />)
      expect(screen.getByText('tools.mcp.modal.addHeader')).toBeInTheDocument()
    })

    it('should not render add header button when empty and readonly', () => {
      render(<HeadersInput {...defaultProps} readonly={true} />)
      expect(screen.queryByText('tools.mcp.modal.addHeader')).not.toBeInTheDocument()
    })

    it('should call onChange with new item when add button is clicked', () => {
      const onChange = vi.fn()
      render(<HeadersInput {...defaultProps} onChange={onChange} />)

      const addButton = screen.getByText('tools.mcp.modal.addHeader')
      fireEvent.click(addButton)

      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({
          key: '',
          value: '',
        }),
      ])
    })
  })

  describe('With Headers', () => {
    const headersItems = [
      { id: '1', key: 'Authorization', value: 'Bearer token123' },
      { id: '2', key: 'Content-Type', value: 'application/json' },
    ]

    it('should render header items', () => {
      render(<HeadersInput {...defaultProps} headersItems={headersItems} />)
      expect(screen.getByDisplayValue('Authorization')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Bearer token123')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Content-Type')).toBeInTheDocument()
      expect(screen.getByDisplayValue('application/json')).toBeInTheDocument()
    })

    it('should render table headers', () => {
      render(<HeadersInput {...defaultProps} headersItems={headersItems} />)
      expect(screen.getByText('tools.mcp.modal.headerKey')).toBeInTheDocument()
      expect(screen.getByText('tools.mcp.modal.headerValue')).toBeInTheDocument()
    })

    it('should render delete buttons for each item when not readonly', () => {
      render(<HeadersInput {...defaultProps} headersItems={headersItems} />)
      // Should have delete buttons for each header
      const deleteButtons = document.querySelectorAll('[class*="text-text-destructive"]')
      expect(deleteButtons.length).toBe(headersItems.length)
    })

    it('should not render delete buttons when readonly', () => {
      render(<HeadersInput {...defaultProps} headersItems={headersItems} readonly={true} />)
      const deleteButtons = document.querySelectorAll('[class*="text-text-destructive"]')
      expect(deleteButtons.length).toBe(0)
    })

    it('should render add button at bottom when not readonly', () => {
      render(<HeadersInput {...defaultProps} headersItems={headersItems} />)
      expect(screen.getByText('tools.mcp.modal.addHeader')).toBeInTheDocument()
    })

    it('should not render add button when readonly', () => {
      render(<HeadersInput {...defaultProps} headersItems={headersItems} readonly={true} />)
      expect(screen.queryByText('tools.mcp.modal.addHeader')).not.toBeInTheDocument()
    })
  })

  describe('Masked Headers', () => {
    const headersItems = [{ id: '1', key: 'Secret', value: '***' }]

    it('should show masked headers tip when isMasked is true', () => {
      render(<HeadersInput {...defaultProps} headersItems={headersItems} isMasked={true} />)
      expect(screen.getByText('tools.mcp.modal.maskedHeadersTip')).toBeInTheDocument()
    })

    it('should not show masked headers tip when isMasked is false', () => {
      render(<HeadersInput {...defaultProps} headersItems={headersItems} isMasked={false} />)
      expect(screen.queryByText('tools.mcp.modal.maskedHeadersTip')).not.toBeInTheDocument()
    })
  })

  describe('Item Interactions', () => {
    const headersItems = [
      { id: '1', key: 'Header1', value: 'Value1' },
    ]

    it('should call onChange when key is changed', () => {
      const onChange = vi.fn()
      render(<HeadersInput {...defaultProps} headersItems={headersItems} onChange={onChange} />)

      const keyInput = screen.getByDisplayValue('Header1')
      fireEvent.change(keyInput, { target: { value: 'NewHeader' } })

      expect(onChange).toHaveBeenCalledWith([
        { id: '1', key: 'NewHeader', value: 'Value1' },
      ])
    })

    it('should call onChange when value is changed', () => {
      const onChange = vi.fn()
      render(<HeadersInput {...defaultProps} headersItems={headersItems} onChange={onChange} />)

      const valueInput = screen.getByDisplayValue('Value1')
      fireEvent.change(valueInput, { target: { value: 'NewValue' } })

      expect(onChange).toHaveBeenCalledWith([
        { id: '1', key: 'Header1', value: 'NewValue' },
      ])
    })

    it('should remove item when delete button is clicked', () => {
      const onChange = vi.fn()
      render(<HeadersInput {...defaultProps} headersItems={headersItems} onChange={onChange} />)

      const deleteButton = document.querySelector('[class*="text-text-destructive"]')?.closest('button')
      if (deleteButton) {
        fireEvent.click(deleteButton)
        expect(onChange).toHaveBeenCalledWith([])
      }
    })

    it('should add new item when add button is clicked', () => {
      const onChange = vi.fn()
      render(<HeadersInput {...defaultProps} headersItems={headersItems} onChange={onChange} />)

      const addButton = screen.getByText('tools.mcp.modal.addHeader')
      fireEvent.click(addButton)

      expect(onChange).toHaveBeenCalledWith([
        { id: '1', key: 'Header1', value: 'Value1' },
        expect.objectContaining({ key: '', value: '' }),
      ])
    })
  })

  describe('Multiple Headers', () => {
    const headersItems = [
      { id: '1', key: 'Header1', value: 'Value1' },
      { id: '2', key: 'Header2', value: 'Value2' },
      { id: '3', key: 'Header3', value: 'Value3' },
    ]

    it('should render all headers', () => {
      render(<HeadersInput {...defaultProps} headersItems={headersItems} />)
      expect(screen.getByDisplayValue('Header1')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Header2')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Header3')).toBeInTheDocument()
    })

    it('should update correct item when changed', () => {
      const onChange = vi.fn()
      render(<HeadersInput {...defaultProps} headersItems={headersItems} onChange={onChange} />)

      const header2Input = screen.getByDisplayValue('Header2')
      fireEvent.change(header2Input, { target: { value: 'UpdatedHeader2' } })

      expect(onChange).toHaveBeenCalledWith([
        { id: '1', key: 'Header1', value: 'Value1' },
        { id: '2', key: 'UpdatedHeader2', value: 'Value2' },
        { id: '3', key: 'Header3', value: 'Value3' },
      ])
    })

    it('should remove correct item when deleted', () => {
      const onChange = vi.fn()
      render(<HeadersInput {...defaultProps} headersItems={headersItems} onChange={onChange} />)

      // Find all delete buttons and click the second one
      const deleteButtons = document.querySelectorAll('[class*="text-text-destructive"]')
      const secondDeleteButton = deleteButtons[1]?.closest('button')
      if (secondDeleteButton) {
        fireEvent.click(secondDeleteButton)
        expect(onChange).toHaveBeenCalledWith([
          { id: '1', key: 'Header1', value: 'Value1' },
          { id: '3', key: 'Header3', value: 'Value3' },
        ])
      }
    })
  })

  describe('Readonly Mode', () => {
    const headersItems = [{ id: '1', key: 'ReadOnly', value: 'Value' }]

    it('should make inputs readonly when readonly is true', () => {
      render(<HeadersInput {...defaultProps} headersItems={headersItems} readonly={true} />)

      const keyInput = screen.getByDisplayValue('ReadOnly')
      const valueInput = screen.getByDisplayValue('Value')

      expect(keyInput).toHaveAttribute('readonly')
      expect(valueInput).toHaveAttribute('readonly')
    })

    it('should not make inputs readonly when readonly is false', () => {
      render(<HeadersInput {...defaultProps} headersItems={headersItems} readonly={false} />)

      const keyInput = screen.getByDisplayValue('ReadOnly')
      const valueInput = screen.getByDisplayValue('Value')

      expect(keyInput).not.toHaveAttribute('readonly')
      expect(valueInput).not.toHaveAttribute('readonly')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty key and value', () => {
      const headersItems = [{ id: '1', key: '', value: '' }]
      render(<HeadersInput {...defaultProps} headersItems={headersItems} />)

      const inputs = screen.getAllByRole('textbox')
      expect(inputs.length).toBe(2)
    })

    it('should handle special characters in header key', () => {
      const headersItems = [{ id: '1', key: 'X-Custom-Header', value: 'value' }]
      render(<HeadersInput {...defaultProps} headersItems={headersItems} />)
      expect(screen.getByDisplayValue('X-Custom-Header')).toBeInTheDocument()
    })

    it('should handle JSON value', () => {
      const headersItems = [{ id: '1', key: 'Data', value: '{"key":"value"}' }]
      render(<HeadersInput {...defaultProps} headersItems={headersItems} />)
      expect(screen.getByDisplayValue('{"key":"value"}')).toBeInTheDocument()
    })
  })
})
