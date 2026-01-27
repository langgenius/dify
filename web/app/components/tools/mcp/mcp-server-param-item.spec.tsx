import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import MCPServerParamItem from './mcp-server-param-item'

describe('MCPServerParamItem', () => {
  const defaultProps = {
    data: {
      label: 'Test Label',
      variable: 'test_variable',
      type: 'string',
    },
    value: '',
    onChange: vi.fn(),
  }

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<MCPServerParamItem {...defaultProps} />)
      expect(screen.getByText('Test Label')).toBeInTheDocument()
    })

    it('should display label', () => {
      render(<MCPServerParamItem {...defaultProps} />)
      expect(screen.getByText('Test Label')).toBeInTheDocument()
    })

    it('should display variable name', () => {
      render(<MCPServerParamItem {...defaultProps} />)
      expect(screen.getByText('test_variable')).toBeInTheDocument()
    })

    it('should display type', () => {
      render(<MCPServerParamItem {...defaultProps} />)
      expect(screen.getByText('string')).toBeInTheDocument()
    })

    it('should display separator dot', () => {
      render(<MCPServerParamItem {...defaultProps} />)
      expect(screen.getByText('·')).toBeInTheDocument()
    })

    it('should render textarea with placeholder', () => {
      render(<MCPServerParamItem {...defaultProps} />)
      const textarea = screen.getByPlaceholderText('tools.mcp.server.modal.parametersPlaceholder')
      expect(textarea).toBeInTheDocument()
    })
  })

  describe('Value Display', () => {
    it('should display empty value by default', () => {
      render(<MCPServerParamItem {...defaultProps} />)
      const textarea = screen.getByPlaceholderText('tools.mcp.server.modal.parametersPlaceholder')
      expect(textarea).toHaveValue('')
    })

    it('should display provided value', () => {
      render(<MCPServerParamItem {...defaultProps} value="test value" />)
      const textarea = screen.getByPlaceholderText('tools.mcp.server.modal.parametersPlaceholder')
      expect(textarea).toHaveValue('test value')
    })

    it('should display long text value', () => {
      const longValue = 'This is a very long text value that might span multiple lines'
      render(<MCPServerParamItem {...defaultProps} value={longValue} />)
      const textarea = screen.getByPlaceholderText('tools.mcp.server.modal.parametersPlaceholder')
      expect(textarea).toHaveValue(longValue)
    })
  })

  describe('User Interactions', () => {
    it('should call onChange when text is entered', () => {
      const onChange = vi.fn()
      render(<MCPServerParamItem {...defaultProps} onChange={onChange} />)

      const textarea = screen.getByPlaceholderText('tools.mcp.server.modal.parametersPlaceholder')
      fireEvent.change(textarea, { target: { value: 'new value' } })

      expect(onChange).toHaveBeenCalledWith('new value')
    })

    it('should call onChange with empty string when cleared', () => {
      const onChange = vi.fn()
      render(<MCPServerParamItem {...defaultProps} value="existing" onChange={onChange} />)

      const textarea = screen.getByPlaceholderText('tools.mcp.server.modal.parametersPlaceholder')
      fireEvent.change(textarea, { target: { value: '' } })

      expect(onChange).toHaveBeenCalledWith('')
    })

    it('should handle multiple changes', () => {
      const onChange = vi.fn()
      render(<MCPServerParamItem {...defaultProps} onChange={onChange} />)

      const textarea = screen.getByPlaceholderText('tools.mcp.server.modal.parametersPlaceholder')

      fireEvent.change(textarea, { target: { value: 'first' } })
      fireEvent.change(textarea, { target: { value: 'second' } })
      fireEvent.change(textarea, { target: { value: 'third' } })

      expect(onChange).toHaveBeenCalledTimes(3)
      expect(onChange).toHaveBeenLastCalledWith('third')
    })
  })

  describe('Different Data Types', () => {
    it('should display number type', () => {
      const props = {
        ...defaultProps,
        data: { label: 'Count', variable: 'count', type: 'number' },
      }
      render(<MCPServerParamItem {...props} />)
      expect(screen.getByText('number')).toBeInTheDocument()
    })

    it('should display boolean type', () => {
      const props = {
        ...defaultProps,
        data: { label: 'Enabled', variable: 'enabled', type: 'boolean' },
      }
      render(<MCPServerParamItem {...props} />)
      expect(screen.getByText('boolean')).toBeInTheDocument()
    })

    it('should display array type', () => {
      const props = {
        ...defaultProps,
        data: { label: 'Items', variable: 'items', type: 'array' },
      }
      render(<MCPServerParamItem {...props} />)
      expect(screen.getByText('array')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle special characters in label', () => {
      const props = {
        ...defaultProps,
        data: { label: 'Test <Label> & "Special"', variable: 'test', type: 'string' },
      }
      render(<MCPServerParamItem {...props} />)
      expect(screen.getByText('Test <Label> & "Special"')).toBeInTheDocument()
    })

    it('should handle empty data object properties', () => {
      const props = {
        ...defaultProps,
        data: { label: '', variable: '', type: '' },
      }
      render(<MCPServerParamItem {...props} />)
      // Should render without crashing
      expect(screen.getByText('·')).toBeInTheDocument()
    })

    it('should handle unicode characters in value', () => {
      const onChange = vi.fn()
      render(<MCPServerParamItem {...defaultProps} onChange={onChange} />)

      const textarea = screen.getByPlaceholderText('tools.mcp.server.modal.parametersPlaceholder')
      fireEvent.change(textarea, { target: { value: '你好世界 🌍' } })

      expect(onChange).toHaveBeenCalledWith('你好世界 🌍')
    })
  })
})
