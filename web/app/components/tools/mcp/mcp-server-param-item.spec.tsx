import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MCPServerParamItem from './mcp-server-param-item'

describe('MCPServerParamItem', () => {
  const mockData = {
    label: 'API Key',
    variable: 'api_key',
    type: 'string',
  }
  const mockOnChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(
        <MCPServerParamItem
          data={mockData}
          value=""
          onChange={mockOnChange}
        />,
      )

      expect(screen.getByText('API Key')).toBeInTheDocument()
    })

    it('should display data label', () => {
      render(
        <MCPServerParamItem
          data={mockData}
          value=""
          onChange={mockOnChange}
        />,
      )

      expect(screen.getByText('API Key')).toBeInTheDocument()
    })

    it('should display data variable', () => {
      render(
        <MCPServerParamItem
          data={mockData}
          value=""
          onChange={mockOnChange}
        />,
      )

      expect(screen.getByText('api_key')).toBeInTheDocument()
    })

    it('should display data type', () => {
      render(
        <MCPServerParamItem
          data={mockData}
          value=""
          onChange={mockOnChange}
        />,
      )

      expect(screen.getByText('string')).toBeInTheDocument()
    })

    it('should display separator dot between label and variable', () => {
      render(
        <MCPServerParamItem
          data={mockData}
          value=""
          onChange={mockOnChange}
        />,
      )

      expect(screen.getByText('·')).toBeInTheDocument()
    })
  })

  describe('Textarea', () => {
    it('should render textarea with correct value', () => {
      render(
        <MCPServerParamItem
          data={mockData}
          value="test-value"
          onChange={mockOnChange}
        />,
      )

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveValue('test-value')
    })

    it('should render textarea with placeholder', () => {
      render(
        <MCPServerParamItem
          data={mockData}
          value=""
          onChange={mockOnChange}
        />,
      )

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveAttribute('placeholder', 'tools.mcp.server.modal.parametersPlaceholder')
    })

    it('should call onChange when textarea value changes', () => {
      render(
        <MCPServerParamItem
          data={mockData}
          value=""
          onChange={mockOnChange}
        />,
      )

      const textarea = screen.getByRole('textbox')
      fireEvent.change(textarea, { target: { value: 'new-value' } })

      expect(mockOnChange).toHaveBeenCalledWith('new-value')
    })
  })

  describe('Props', () => {
    it('should handle different data types', () => {
      const numberData = {
        label: 'Port',
        variable: 'port',
        type: 'number',
      }

      render(
        <MCPServerParamItem
          data={numberData}
          value="8080"
          onChange={mockOnChange}
        />,
      )

      expect(screen.getByText('Port')).toBeInTheDocument()
      expect(screen.getByText('port')).toBeInTheDocument()
      expect(screen.getByText('number')).toBeInTheDocument()
    })

    it('should handle empty value', () => {
      render(
        <MCPServerParamItem
          data={mockData}
          value=""
          onChange={mockOnChange}
        />,
      )

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveValue('')
    })
  })
})
