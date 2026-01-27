import type { ReactNode } from 'react'
import type { MCPServerDetail } from '@/app/components/tools/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import MCPServerModal from './mcp-server-modal'

// Mock the services
vi.mock('@/service/use-tools', () => ({
  useCreateMCPServer: () => ({
    mutateAsync: vi.fn().mockResolvedValue({ result: 'success' }),
    isPending: false,
  }),
  useUpdateMCPServer: () => ({
    mutateAsync: vi.fn().mockResolvedValue({ result: 'success' }),
    isPending: false,
  }),
  useInvalidateMCPServerDetail: () => vi.fn(),
}))

describe('MCPServerModal', () => {
  const createWrapper = () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })
    return ({ children }: { children: ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)
  }

  const defaultProps = {
    appID: 'app-123',
    show: true,
    onHide: vi.fn(),
  }

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<MCPServerModal {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByText('tools.mcp.server.modal.addTitle')).toBeInTheDocument()
    })

    it('should render add title when no data is provided', () => {
      render(<MCPServerModal {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByText('tools.mcp.server.modal.addTitle')).toBeInTheDocument()
    })

    it('should render edit title when data is provided', () => {
      const mockData = {
        id: 'server-1',
        description: 'Existing description',
        parameters: {},
      } as unknown as MCPServerDetail

      render(<MCPServerModal {...defaultProps} data={mockData} />, { wrapper: createWrapper() })
      expect(screen.getByText('tools.mcp.server.modal.editTitle')).toBeInTheDocument()
    })

    it('should render description label', () => {
      render(<MCPServerModal {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByText('tools.mcp.server.modal.description')).toBeInTheDocument()
    })

    it('should render required indicator', () => {
      render(<MCPServerModal {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByText('*')).toBeInTheDocument()
    })

    it('should render description textarea', () => {
      render(<MCPServerModal {...defaultProps} />, { wrapper: createWrapper() })
      const textarea = screen.getByPlaceholderText('tools.mcp.server.modal.descriptionPlaceholder')
      expect(textarea).toBeInTheDocument()
    })

    it('should render cancel button', () => {
      render(<MCPServerModal {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByText('tools.mcp.modal.cancel')).toBeInTheDocument()
    })

    it('should render confirm button in add mode', () => {
      render(<MCPServerModal {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByText('tools.mcp.server.modal.confirm')).toBeInTheDocument()
    })

    it('should render save button in edit mode', () => {
      const mockData = {
        id: 'server-1',
        description: 'Existing description',
        parameters: {},
      } as unknown as MCPServerDetail

      render(<MCPServerModal {...defaultProps} data={mockData} />, { wrapper: createWrapper() })
      expect(screen.getByText('tools.mcp.modal.save')).toBeInTheDocument()
    })

    it('should render close icon', () => {
      render(<MCPServerModal {...defaultProps} />, { wrapper: createWrapper() })
      const closeButton = document.querySelector('.cursor-pointer svg')
      expect(closeButton).toBeInTheDocument()
    })
  })

  describe('Parameters Section', () => {
    it('should not render parameters section when no latestParams', () => {
      render(<MCPServerModal {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.queryByText('tools.mcp.server.modal.parameters')).not.toBeInTheDocument()
    })

    it('should render parameters section when latestParams is provided', () => {
      const latestParams = [
        { variable: 'param1', label: 'Parameter 1', type: 'string' },
      ]
      render(<MCPServerModal {...defaultProps} latestParams={latestParams} />, { wrapper: createWrapper() })
      expect(screen.getByText('tools.mcp.server.modal.parameters')).toBeInTheDocument()
    })

    it('should render parameters tip', () => {
      const latestParams = [
        { variable: 'param1', label: 'Parameter 1', type: 'string' },
      ]
      render(<MCPServerModal {...defaultProps} latestParams={latestParams} />, { wrapper: createWrapper() })
      expect(screen.getByText('tools.mcp.server.modal.parametersTip')).toBeInTheDocument()
    })

    it('should render parameter items', () => {
      const latestParams = [
        { variable: 'param1', label: 'Parameter 1', type: 'string' },
        { variable: 'param2', label: 'Parameter 2', type: 'number' },
      ]
      render(<MCPServerModal {...defaultProps} latestParams={latestParams} />, { wrapper: createWrapper() })
      expect(screen.getByText('Parameter 1')).toBeInTheDocument()
      expect(screen.getByText('Parameter 2')).toBeInTheDocument()
    })
  })

  describe('Form Interactions', () => {
    it('should update description when typing', () => {
      render(<MCPServerModal {...defaultProps} />, { wrapper: createWrapper() })

      const textarea = screen.getByPlaceholderText('tools.mcp.server.modal.descriptionPlaceholder')
      fireEvent.change(textarea, { target: { value: 'New description' } })

      expect(textarea).toHaveValue('New description')
    })

    it('should call onHide when cancel button is clicked', () => {
      const onHide = vi.fn()
      render(<MCPServerModal {...defaultProps} onHide={onHide} />, { wrapper: createWrapper() })

      const cancelButton = screen.getByText('tools.mcp.modal.cancel')
      fireEvent.click(cancelButton)

      expect(onHide).toHaveBeenCalledTimes(1)
    })

    it('should call onHide when close icon is clicked', () => {
      const onHide = vi.fn()
      render(<MCPServerModal {...defaultProps} onHide={onHide} />, { wrapper: createWrapper() })

      const closeButton = document.querySelector('.cursor-pointer')
      if (closeButton) {
        fireEvent.click(closeButton)
        expect(onHide).toHaveBeenCalled()
      }
    })

    it('should disable confirm button when description is empty', () => {
      render(<MCPServerModal {...defaultProps} />, { wrapper: createWrapper() })

      const confirmButton = screen.getByText('tools.mcp.server.modal.confirm')
      expect(confirmButton).toBeDisabled()
    })

    it('should enable confirm button when description is filled', () => {
      render(<MCPServerModal {...defaultProps} />, { wrapper: createWrapper() })

      const textarea = screen.getByPlaceholderText('tools.mcp.server.modal.descriptionPlaceholder')
      fireEvent.change(textarea, { target: { value: 'Valid description' } })

      const confirmButton = screen.getByText('tools.mcp.server.modal.confirm')
      expect(confirmButton).not.toBeDisabled()
    })
  })

  describe('Edit Mode', () => {
    const mockData = {
      id: 'server-1',
      description: 'Existing description',
      parameters: { param1: 'existing value' },
    } as unknown as MCPServerDetail

    it('should populate description with existing value', () => {
      render(<MCPServerModal {...defaultProps} data={mockData} />, { wrapper: createWrapper() })

      const textarea = screen.getByPlaceholderText('tools.mcp.server.modal.descriptionPlaceholder')
      expect(textarea).toHaveValue('Existing description')
    })

    it('should populate parameters with existing values', () => {
      const latestParams = [
        { variable: 'param1', label: 'Parameter 1', type: 'string' },
      ]
      render(
        <MCPServerModal {...defaultProps} data={mockData} latestParams={latestParams} />,
        { wrapper: createWrapper() },
      )

      const paramInput = screen.getByPlaceholderText('tools.mcp.server.modal.parametersPlaceholder')
      expect(paramInput).toHaveValue('existing value')
    })
  })

  describe('Form Submission', () => {
    it('should submit form with description', async () => {
      const onHide = vi.fn()
      render(<MCPServerModal {...defaultProps} onHide={onHide} />, { wrapper: createWrapper() })

      const textarea = screen.getByPlaceholderText('tools.mcp.server.modal.descriptionPlaceholder')
      fireEvent.change(textarea, { target: { value: 'Test description' } })

      const confirmButton = screen.getByText('tools.mcp.server.modal.confirm')
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(onHide).toHaveBeenCalled()
      })
    })
  })

  describe('With App Info', () => {
    it('should use appInfo description as default when no data', () => {
      const appInfo = { description: 'App default description' }
      render(<MCPServerModal {...defaultProps} appInfo={appInfo} />, { wrapper: createWrapper() })

      const textarea = screen.getByPlaceholderText('tools.mcp.server.modal.descriptionPlaceholder')
      expect(textarea).toHaveValue('App default description')
    })

    it('should prefer data description over appInfo description', () => {
      const appInfo = { description: 'App default description' }
      const mockData = {
        id: 'server-1',
        description: 'Data description',
        parameters: {},
      } as unknown as MCPServerDetail

      render(
        <MCPServerModal {...defaultProps} data={mockData} appInfo={appInfo} />,
        { wrapper: createWrapper() },
      )

      const textarea = screen.getByPlaceholderText('tools.mcp.server.modal.descriptionPlaceholder')
      expect(textarea).toHaveValue('Data description')
    })
  })

  describe('Not Shown State', () => {
    it('should not render modal content when show is false', () => {
      render(<MCPServerModal {...defaultProps} show={false} />, { wrapper: createWrapper() })
      expect(screen.queryByText('tools.mcp.server.modal.addTitle')).not.toBeInTheDocument()
    })
  })

  describe('Update Mode Submission', () => {
    it('should submit update when data is provided', async () => {
      const onHide = vi.fn()
      const mockData = {
        id: 'server-1',
        description: 'Existing description',
        parameters: { param1: 'value1' },
      } as unknown as MCPServerDetail

      render(
        <MCPServerModal {...defaultProps} data={mockData} onHide={onHide} />,
        { wrapper: createWrapper() },
      )

      // Change description
      const textarea = screen.getByPlaceholderText('tools.mcp.server.modal.descriptionPlaceholder')
      fireEvent.change(textarea, { target: { value: 'Updated description' } })

      // Click save button
      const saveButton = screen.getByText('tools.mcp.modal.save')
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(onHide).toHaveBeenCalled()
      })
    })
  })

  describe('Parameter Handling', () => {
    it('should update parameter value when changed', async () => {
      const latestParams = [
        { variable: 'param1', label: 'Parameter 1', type: 'string' },
        { variable: 'param2', label: 'Parameter 2', type: 'string' },
      ]

      render(
        <MCPServerModal {...defaultProps} latestParams={latestParams} />,
        { wrapper: createWrapper() },
      )

      // Fill description first
      const textarea = screen.getByPlaceholderText('tools.mcp.server.modal.descriptionPlaceholder')
      fireEvent.change(textarea, { target: { value: 'Test description' } })

      // Get all parameter inputs
      const paramInputs = screen.getAllByPlaceholderText('tools.mcp.server.modal.parametersPlaceholder')

      // Change the first parameter value
      fireEvent.change(paramInputs[0], { target: { value: 'new param value' } })

      expect(paramInputs[0]).toHaveValue('new param value')
    })

    it('should submit with parameter values', async () => {
      const onHide = vi.fn()
      const latestParams = [
        { variable: 'param1', label: 'Parameter 1', type: 'string' },
      ]

      render(
        <MCPServerModal {...defaultProps} latestParams={latestParams} onHide={onHide} />,
        { wrapper: createWrapper() },
      )

      // Fill description
      const textarea = screen.getByPlaceholderText('tools.mcp.server.modal.descriptionPlaceholder')
      fireEvent.change(textarea, { target: { value: 'Test description' } })

      // Fill parameter
      const paramInput = screen.getByPlaceholderText('tools.mcp.server.modal.parametersPlaceholder')
      fireEvent.change(paramInput, { target: { value: 'param value' } })

      // Submit
      const confirmButton = screen.getByText('tools.mcp.server.modal.confirm')
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(onHide).toHaveBeenCalled()
      })
    })

    it('should handle empty description submission', async () => {
      const onHide = vi.fn()
      render(<MCPServerModal {...defaultProps} onHide={onHide} />, { wrapper: createWrapper() })

      const textarea = screen.getByPlaceholderText('tools.mcp.server.modal.descriptionPlaceholder')
      fireEvent.change(textarea, { target: { value: '' } })

      // Button should be disabled
      const confirmButton = screen.getByText('tools.mcp.server.modal.confirm')
      expect(confirmButton).toBeDisabled()
    })
  })
})
