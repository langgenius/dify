import type { ReactNode } from 'react'
import type { MCPServerDetail } from '@/app/components/tools/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import MCPServerModal from '../mcp-server-modal'

const serviceMocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  invalidate: vi.fn(),
  creating: false,
  updating: false,
}))

vi.mock('@/service/use-tools', () => ({
  useCreateMCPServer: () => ({
    mutateAsync: serviceMocks.create,
    isPending: serviceMocks.creating,
  }),
  useUpdateMCPServer: () => ({
    mutateAsync: serviceMocks.update,
    isPending: serviceMocks.updating,
  }),
  useInvalidateMCPServerDetail: () => serviceMocks.invalidate,
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

  beforeEach(() => {
    vi.clearAllMocks()
    serviceMocks.create.mockResolvedValue({ result: 'success' })
    serviceMocks.update.mockResolvedValue({ result: 'success' })
    serviceMocks.creating = false
    serviceMocks.updating = false
  })

  describe('Rendering', () => {
    it('should render add title when no data is provided', () => {
      render(<MCPServerModal {...defaultProps} />, { wrapper: createWrapper() })
      expect(
        screen.getByRole('dialog', { name: 'tools.mcp.server.modal.addTitle' }),
      )!.toBeInTheDocument()
    })

    it('should render edit title when data is provided', () => {
      const mockData = {
        id: 'server-1',
        description: 'Existing description',
        parameters: {},
      } as unknown as MCPServerDetail

      render(<MCPServerModal {...defaultProps} data={mockData} />, { wrapper: createWrapper() })
      expect(
        screen.getByRole('dialog', { name: 'tools.mcp.server.modal.editTitle' }),
      )!.toBeInTheDocument()
    })

    it('should render description label', () => {
      render(<MCPServerModal {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByText('tools.mcp.server.modal.description'))!.toBeInTheDocument()
    })

    it('should render required indicator', () => {
      render(<MCPServerModal {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByText('*'))!.toBeInTheDocument()
    })

    it('should render description textarea', () => {
      render(<MCPServerModal {...defaultProps} />, { wrapper: createWrapper() })
      const textarea = screen.getByRole('textbox', { name: 'tools.mcp.server.modal.description' })
      expect(textarea)!.toBeInTheDocument()
      expect(textarea).toBeRequired()
    })

    it('should render cancel button', () => {
      render(<MCPServerModal {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByRole('button', { name: 'tools.mcp.modal.cancel' }))!.toBeInTheDocument()
    })

    it('should render confirm button in add mode', () => {
      render(<MCPServerModal {...defaultProps} />, { wrapper: createWrapper() })
      expect(
        screen.getByRole('button', { name: 'tools.mcp.server.modal.confirm' }),
      )!.toBeInTheDocument()
    })

    it('should render save button in edit mode', () => {
      const mockData = {
        id: 'server-1',
        description: 'Existing description',
        parameters: {},
      } as unknown as MCPServerDetail

      render(<MCPServerModal {...defaultProps} data={mockData} />, { wrapper: createWrapper() })
      expect(screen.getByRole('button', { name: 'tools.mcp.modal.save' }))!.toBeInTheDocument()
    })

    it('should render close icon', () => {
      render(<MCPServerModal {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByRole('button', { name: /operation\.close/ }))!.toBeInTheDocument()
    })
  })

  describe('Parameters Section', () => {
    it('should not render parameters section when no latestParams', () => {
      render(<MCPServerModal {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.queryByText('tools.mcp.server.modal.parameters')).not.toBeInTheDocument()
    })

    it('should render parameters section when latestParams is provided', () => {
      const latestParams = [{ variable: 'param1', label: 'Parameter 1', type: 'string' }]
      render(<MCPServerModal {...defaultProps} latestParams={latestParams} />, {
        wrapper: createWrapper(),
      })
      expect(screen.getByText('tools.mcp.server.modal.parameters'))!.toBeInTheDocument()
    })

    it('should render parameters tip', () => {
      const latestParams = [{ variable: 'param1', label: 'Parameter 1', type: 'string' }]
      render(<MCPServerModal {...defaultProps} latestParams={latestParams} />, {
        wrapper: createWrapper(),
      })
      expect(screen.getByText('tools.mcp.server.modal.parametersTip'))!.toBeInTheDocument()
    })

    it('should render parameter items', () => {
      const latestParams = [
        { variable: 'param1', label: 'Parameter 1', type: 'string' },
        { variable: 'param2', label: 'Parameter 2', type: 'number' },
      ]
      render(<MCPServerModal {...defaultProps} latestParams={latestParams} />, {
        wrapper: createWrapper(),
      })
      expect(screen.getByText('Parameter 1'))!.toBeInTheDocument()
      expect(screen.getByText('Parameter 2'))!.toBeInTheDocument()
    })
  })

  describe('Form Interactions', () => {
    it('should update description when typing', () => {
      render(<MCPServerModal {...defaultProps} />, { wrapper: createWrapper() })

      const textarea = screen.getByRole('textbox', { name: 'tools.mcp.server.modal.description' })
      fireEvent.change(textarea, { target: { value: 'New description' } })

      expect(textarea)!.toHaveValue('New description')
    })

    it('should call onHide when cancel button is clicked', () => {
      const onHide = vi.fn()
      render(<MCPServerModal {...defaultProps} onHide={onHide} />, { wrapper: createWrapper() })

      const cancelButton = screen.getByRole('button', { name: 'tools.mcp.modal.cancel' })
      fireEvent.click(cancelButton)

      expect(onHide).toHaveBeenCalledTimes(1)
    })

    it('should call onHide when close icon is clicked', () => {
      const onHide = vi.fn()
      render(<MCPServerModal {...defaultProps} onHide={onHide} />, { wrapper: createWrapper() })

      fireEvent.click(screen.getByRole('button', { name: /operation\.close/ }))
      expect(onHide).toHaveBeenCalled()
    })

    it('should call onHide when the dialog requests close', () => {
      const onHide = vi.fn()
      render(<MCPServerModal {...defaultProps} onHide={onHide} />, { wrapper: createWrapper() })

      fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })

      expect(onHide).toHaveBeenCalledTimes(1)
    })

    it('should disable confirm button when description is empty', () => {
      render(<MCPServerModal {...defaultProps} />, { wrapper: createWrapper() })

      const confirmButton = screen.getByRole('button', { name: 'tools.mcp.server.modal.confirm' })
      expect(confirmButton)!.toBeDisabled()
    })

    it('should enable confirm button when description is filled', () => {
      render(<MCPServerModal {...defaultProps} />, { wrapper: createWrapper() })

      const textarea = screen.getByRole('textbox', { name: 'tools.mcp.server.modal.description' })
      fireEvent.change(textarea, { target: { value: 'Valid description' } })

      const confirmButton = screen.getByRole('button', { name: 'tools.mcp.server.modal.confirm' })
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

      const textarea = screen.getByRole('textbox', { name: 'tools.mcp.server.modal.description' })
      expect(textarea)!.toHaveValue('Existing description')
    })

    it('should populate parameters with existing values', () => {
      const latestParams = [{ variable: 'param1', label: 'Parameter 1', type: 'string' }]
      render(<MCPServerModal {...defaultProps} data={mockData} latestParams={latestParams} />, {
        wrapper: createWrapper(),
      })

      const paramInput = screen.getByRole('textbox', { name: 'Parameter 1' })
      expect(paramInput)!.toHaveValue('existing value')
    })
  })

  describe('Form Submission', () => {
    it('should submit form with description', async () => {
      const onHide = vi.fn()
      render(<MCPServerModal {...defaultProps} onHide={onHide} />, { wrapper: createWrapper() })

      const textarea = screen.getByRole('textbox', { name: 'tools.mcp.server.modal.description' })
      fireEvent.change(textarea, { target: { value: 'Test description' } })

      const confirmButton = screen.getByRole('button', { name: 'tools.mcp.server.modal.confirm' })
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(onHide).toHaveBeenCalled()
      })
      expect(serviceMocks.create).toHaveBeenCalledWith({
        appID: 'app-123',
        description: 'Test description',
        parameters: {},
      })
    })
  })

  describe('With App Info', () => {
    it('should use appInfo description as default when no data', () => {
      const appInfo = { description: 'App default description' }
      render(<MCPServerModal {...defaultProps} appInfo={appInfo} />, { wrapper: createWrapper() })

      const textarea = screen.getByRole('textbox', { name: 'tools.mcp.server.modal.description' })
      expect(textarea)!.toHaveValue('App default description')
    })

    it('should prefer data description over appInfo description', () => {
      const appInfo = { description: 'App default description' }
      const mockData = {
        id: 'server-1',
        description: 'Data description',
        parameters: {},
      } as unknown as MCPServerDetail

      render(<MCPServerModal {...defaultProps} data={mockData} appInfo={appInfo} />, {
        wrapper: createWrapper(),
      })

      const textarea = screen.getByRole('textbox', { name: 'tools.mcp.server.modal.description' })
      expect(textarea)!.toHaveValue('Data description')
    })
  })

  describe('Not Shown State', () => {
    it('should not render modal content when show is false', () => {
      render(<MCPServerModal {...defaultProps} show={false} />, { wrapper: createWrapper() })
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
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

      render(<MCPServerModal {...defaultProps} data={mockData} onHide={onHide} />, {
        wrapper: createWrapper(),
      })

      // Change description
      const textarea = screen.getByRole('textbox', { name: 'tools.mcp.server.modal.description' })
      fireEvent.change(textarea, { target: { value: 'Updated description' } })

      // Click save button
      const saveButton = screen.getByRole('button', { name: 'tools.mcp.modal.save' })
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(onHide).toHaveBeenCalled()
      })
      expect(serviceMocks.update).toHaveBeenCalledWith({
        appID: 'app-123',
        id: 'server-1',
        description: 'Updated description',
        parameters: {},
      })
    })
  })

  describe('Parameter Handling', () => {
    it('should update parameter value when changed', async () => {
      const latestParams = [
        { variable: 'param1', label: 'Parameter 1', type: 'string' },
        { variable: 'param2', label: 'Parameter 2', type: 'string' },
      ]

      render(<MCPServerModal {...defaultProps} latestParams={latestParams} />, {
        wrapper: createWrapper(),
      })

      // Fill description first
      const textarea = screen.getByRole('textbox', { name: 'tools.mcp.server.modal.description' })
      fireEvent.change(textarea, { target: { value: 'Test description' } })

      // Get all parameter inputs
      const paramInputs = screen.getAllByRole('textbox', { name: /^Parameter/ })

      // Change the first parameter value
      fireEvent.change(paramInputs[0]!, { target: { value: 'new param value' } })

      expect(paramInputs[0])!.toHaveValue('new param value')
    })

    it('should submit with parameter values', async () => {
      const onHide = vi.fn()
      const latestParams = [{ variable: 'param1', label: 'Parameter 1', type: 'string' }]

      render(<MCPServerModal {...defaultProps} latestParams={latestParams} onHide={onHide} />, {
        wrapper: createWrapper(),
      })

      // Fill description
      const textarea = screen.getByRole('textbox', { name: 'tools.mcp.server.modal.description' })
      fireEvent.change(textarea, { target: { value: 'Test description' } })

      // Fill parameter
      const paramInput = screen.getByRole('textbox', { name: 'Parameter 1' })
      fireEvent.change(paramInput, { target: { value: 'param value' } })

      // Submit
      const confirmButton = screen.getByRole('button', { name: 'tools.mcp.server.modal.confirm' })
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(onHide).toHaveBeenCalled()
      })
      expect(serviceMocks.create).toHaveBeenCalledWith({
        appID: 'app-123',
        description: 'Test description',
        parameters: { param1: 'param value' },
      })
    })

    it('should ignore parameters without variables when rendering and submitting', async () => {
      const onHide = vi.fn()
      const latestParams = [{ label: 'Missing variable', type: 'string' }]

      render(<MCPServerModal {...defaultProps} latestParams={latestParams} onHide={onHide} />, {
        wrapper: createWrapper(),
      })

      expect(screen.queryByText('Missing variable')).not.toBeInTheDocument()

      fireEvent.change(
        screen.getByRole('textbox', { name: 'tools.mcp.server.modal.description' }),
        {
          target: { value: 'Test description' },
        },
      )
      fireEvent.click(screen.getByRole('button', { name: 'tools.mcp.server.modal.confirm' }))

      await waitFor(() => {
        expect(onHide).toHaveBeenCalled()
      })
    })

    it('should handle empty description submission', async () => {
      const onHide = vi.fn()
      render(<MCPServerModal {...defaultProps} onHide={onHide} />, { wrapper: createWrapper() })

      const textarea = screen.getByRole('textbox', { name: 'tools.mcp.server.modal.description' })
      fireEvent.change(textarea, { target: { value: '' } })

      // Button should be disabled
      const confirmButton = screen.getByRole('button', { name: 'tools.mcp.server.modal.confirm' })
      expect(confirmButton)!.toBeDisabled()
    })
  })

  it('keeps the submit action focused and prevents duplicate keyboard submission while saving', async () => {
    const user = userEvent.setup()
    const props = { ...defaultProps, appInfo: { description: 'App description' } }
    const { rerender } = render(<MCPServerModal {...props} />, { wrapper: createWrapper() })
    const submit = screen.getByRole('button', { name: 'tools.mcp.server.modal.confirm' })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /operation\.close/ })).toHaveFocus(),
    )
    submit.focus()
    serviceMocks.creating = true
    rerender(<MCPServerModal {...props} />)

    expect(submit).toHaveFocus()
    expect(submit).toHaveAttribute('aria-disabled', 'true')
    await user.keyboard('{Enter} ')
    expect(serviceMocks.create).not.toHaveBeenCalled()

    serviceMocks.creating = false
    rerender(<MCPServerModal {...props} />)
    await user.keyboard('{Enter}')
    await waitFor(() => expect(serviceMocks.create).toHaveBeenCalledOnce())
    expect(serviceMocks.invalidate).toHaveBeenCalledWith('app-123')
  })
})
