import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import HeadersSection from './headers-section'

describe('HeadersSection', () => {
  const defaultProps = {
    headers: [],
    onHeadersChange: vi.fn(),
    isCreate: true,
  }

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<HeadersSection {...defaultProps} />)
      expect(screen.getByText('tools.mcp.modal.headers')).toBeInTheDocument()
    })

    it('should render headers label', () => {
      render(<HeadersSection {...defaultProps} />)
      expect(screen.getByText('tools.mcp.modal.headers')).toBeInTheDocument()
    })

    it('should render headers tip', () => {
      render(<HeadersSection {...defaultProps} />)
      expect(screen.getByText('tools.mcp.modal.headersTip')).toBeInTheDocument()
    })

    it('should render empty state when no headers', () => {
      render(<HeadersSection {...defaultProps} headers={[]} />)
      expect(screen.getByText('tools.mcp.modal.noHeaders')).toBeInTheDocument()
    })

    it('should render add header button when empty', () => {
      render(<HeadersSection {...defaultProps} headers={[]} />)
      expect(screen.getByText('tools.mcp.modal.addHeader')).toBeInTheDocument()
    })
  })

  describe('With Headers', () => {
    const headersWithItems = [
      { id: '1', key: 'Authorization', value: 'Bearer token123' },
      { id: '2', key: 'Content-Type', value: 'application/json' },
    ]

    it('should render header items', () => {
      render(<HeadersSection {...defaultProps} headers={headersWithItems} />)
      expect(screen.getByDisplayValue('Authorization')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Bearer token123')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Content-Type')).toBeInTheDocument()
      expect(screen.getByDisplayValue('application/json')).toBeInTheDocument()
    })

    it('should render table headers', () => {
      render(<HeadersSection {...defaultProps} headers={headersWithItems} />)
      expect(screen.getByText('tools.mcp.modal.headerKey')).toBeInTheDocument()
      expect(screen.getByText('tools.mcp.modal.headerValue')).toBeInTheDocument()
    })

    it('should show masked tip when not isCreate and has headers with content', () => {
      render(
        <HeadersSection
          {...defaultProps}
          isCreate={false}
          headers={headersWithItems}
        />,
      )
      expect(screen.getByText('tools.mcp.modal.maskedHeadersTip')).toBeInTheDocument()
    })

    it('should not show masked tip when isCreate is true', () => {
      render(
        <HeadersSection
          {...defaultProps}
          isCreate={true}
          headers={headersWithItems}
        />,
      )
      expect(screen.queryByText('tools.mcp.modal.maskedHeadersTip')).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onHeadersChange when adding a header', () => {
      const onHeadersChange = vi.fn()
      render(<HeadersSection {...defaultProps} onHeadersChange={onHeadersChange} />)

      const addButton = screen.getByText('tools.mcp.modal.addHeader')
      fireEvent.click(addButton)

      expect(onHeadersChange).toHaveBeenCalled()
      const calledWithHeaders = onHeadersChange.mock.calls[0][0]
      expect(calledWithHeaders).toHaveLength(1)
      expect(calledWithHeaders[0]).toHaveProperty('id')
      expect(calledWithHeaders[0]).toHaveProperty('key', '')
      expect(calledWithHeaders[0]).toHaveProperty('value', '')
    })

    it('should call onHeadersChange when editing header key', () => {
      const onHeadersChange = vi.fn()
      const headers = [{ id: '1', key: '', value: '' }]
      render(
        <HeadersSection
          {...defaultProps}
          headers={headers}
          onHeadersChange={onHeadersChange}
        />,
      )

      const inputs = screen.getAllByRole('textbox')
      const keyInput = inputs[0]
      fireEvent.change(keyInput, { target: { value: 'X-Custom-Header' } })

      expect(onHeadersChange).toHaveBeenCalled()
    })

    it('should call onHeadersChange when editing header value', () => {
      const onHeadersChange = vi.fn()
      const headers = [{ id: '1', key: 'X-Custom-Header', value: '' }]
      render(
        <HeadersSection
          {...defaultProps}
          headers={headers}
          onHeadersChange={onHeadersChange}
        />,
      )

      const inputs = screen.getAllByRole('textbox')
      const valueInput = inputs[1]
      fireEvent.change(valueInput, { target: { value: 'custom-value' } })

      expect(onHeadersChange).toHaveBeenCalled()
    })

    it('should call onHeadersChange when removing a header', () => {
      const onHeadersChange = vi.fn()
      const headers = [{ id: '1', key: 'X-Header', value: 'value' }]
      render(
        <HeadersSection
          {...defaultProps}
          headers={headers}
          onHeadersChange={onHeadersChange}
        />,
      )

      // Find and click the delete button
      const deleteButton = screen.getByRole('button', { name: '' })
      fireEvent.click(deleteButton)

      expect(onHeadersChange).toHaveBeenCalledWith([])
    })
  })

  describe('Props', () => {
    it('should pass isCreate=true correctly (no masking)', () => {
      const headers = [{ id: '1', key: 'Header', value: 'Value' }]
      render(<HeadersSection {...defaultProps} isCreate={true} headers={headers} />)
      expect(screen.queryByText('tools.mcp.modal.maskedHeadersTip')).not.toBeInTheDocument()
    })

    it('should pass isCreate=false correctly (with masking)', () => {
      const headers = [{ id: '1', key: 'Header', value: 'Value' }]
      render(<HeadersSection {...defaultProps} isCreate={false} headers={headers} />)
      expect(screen.getByText('tools.mcp.modal.maskedHeadersTip')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle headers with empty keys (no masking even when not isCreate)', () => {
      const headers = [{ id: '1', key: '', value: 'Value' }]
      render(<HeadersSection {...defaultProps} isCreate={false} headers={headers} />)
      // Empty key headers don't trigger masking
      expect(screen.queryByText('tools.mcp.modal.maskedHeadersTip')).not.toBeInTheDocument()
    })

    it('should handle headers with whitespace-only keys', () => {
      const headers = [{ id: '1', key: '   ', value: 'Value' }]
      render(<HeadersSection {...defaultProps} isCreate={false} headers={headers} />)
      // Whitespace-only key doesn't count as having content
      expect(screen.queryByText('tools.mcp.modal.maskedHeadersTip')).not.toBeInTheDocument()
    })

    it('should handle multiple headers where some have empty keys', () => {
      const headers = [
        { id: '1', key: '', value: 'Value1' },
        { id: '2', key: 'ValidKey', value: 'Value2' },
      ]
      render(<HeadersSection {...defaultProps} isCreate={false} headers={headers} />)
      // At least one header has a non-empty key, so masking should apply
      expect(screen.getByText('tools.mcp.modal.maskedHeadersTip')).toBeInTheDocument()
    })
  })
})
