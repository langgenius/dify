import type { ReactNode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MCPServerModal from './mcp-server-modal'

type MockData = Parameters<typeof MCPServerModal>[0]['data']

type MockParamData = {
  variable: string
  label: string
  type: string
}

// Mock service hooks
const mockCreateMCPServer = vi.fn()
const mockUpdateMCPServer = vi.fn()
const mockInvalidate = vi.fn()

vi.mock('@/service/use-tools', () => ({
  useCreateMCPServer: () => ({
    mutateAsync: mockCreateMCPServer,
    isPending: false,
  }),
  useUpdateMCPServer: () => ({
    mutateAsync: mockUpdateMCPServer,
    isPending: false,
  }),
  useInvalidateMCPServerDetail: () => mockInvalidate,
}))

// Mock Modal component
vi.mock('@/app/components/base/modal', () => ({
  default: ({ isShow, onClose, children }: { isShow: boolean, onClose: () => void, children: ReactNode }) => {
    if (!isShow)
      return null
    return (
      <div data-testid="modal">
        <button data-testid="close-btn" onClick={onClose}>X</button>
        {children}
      </div>
    )
  },
}))

// Mock MCPServerParamItem
vi.mock('@/app/components/tools/mcp/mcp-server-param-item', () => ({
  default: ({ data, value, onChange }: { data: MockParamData, value: string, onChange: (value: string) => void }) => (
    <div data-testid={`param-${data.variable}`}>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        data-testid={`param-input-${data.variable}`}
      />
    </div>
  ),
}))

describe('MCPServerModal', () => {
  const mockOnHide = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockCreateMCPServer.mockResolvedValue({})
    mockUpdateMCPServer.mockResolvedValue({})
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Rendering', () => {
    it('should not render when show is false', () => {
      render(
        <MCPServerModal
          appID="app-1"
          show={false}
          onHide={mockOnHide}
        />,
      )

      expect(screen.queryByTestId('modal')).not.toBeInTheDocument()
    })

    it('should render modal when show is true', () => {
      render(
        <MCPServerModal
          appID="app-1"
          show={true}
          onHide={mockOnHide}
        />,
      )

      expect(screen.getByTestId('modal')).toBeInTheDocument()
    })

    it('should show add title when no data provided', () => {
      render(
        <MCPServerModal
          appID="app-1"
          show={true}
          onHide={mockOnHide}
        />,
      )

      expect(screen.getByText('tools.mcp.server.modal.addTitle')).toBeInTheDocument()
    })

    it('should show edit title when data is provided', () => {
      render(
        <MCPServerModal
          appID="app-1"
          data={{ id: 'server-1', description: 'test' } as unknown as MockData}
          show={true}
          onHide={mockOnHide}
        />,
      )

      expect(screen.getByText('tools.mcp.server.modal.editTitle')).toBeInTheDocument()
    })
  })

  describe('Description Field', () => {
    it('should render description textarea', () => {
      render(
        <MCPServerModal
          appID="app-1"
          show={true}
          onHide={mockOnHide}
        />,
      )

      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('should show description label', () => {
      render(
        <MCPServerModal
          appID="app-1"
          show={true}
          onHide={mockOnHide}
        />,
      )

      expect(screen.getByText('tools.mcp.server.modal.description')).toBeInTheDocument()
    })

    it('should pre-fill description from data', () => {
      render(
        <MCPServerModal
          appID="app-1"
          data={{ id: 'server-1', description: 'Existing description' } as unknown as MockData}
          show={true}
          onHide={mockOnHide}
        />,
      )

      expect(screen.getByDisplayValue('Existing description')).toBeInTheDocument()
    })

    it('should pre-fill description from appInfo', () => {
      render(
        <MCPServerModal
          appID="app-1"
          appInfo={{ description: 'App description' }}
          show={true}
          onHide={mockOnHide}
        />,
      )

      expect(screen.getByDisplayValue('App description')).toBeInTheDocument()
    })
  })

  describe('Parameters', () => {
    const mockParams = [
      { label: 'API Key', variable: 'api_key', type: 'string' },
      { label: 'Secret', variable: 'secret', type: 'string' },
    ]

    it('should not render parameters section when no params', () => {
      render(
        <MCPServerModal
          appID="app-1"
          latestParams={[]}
          show={true}
          onHide={mockOnHide}
        />,
      )

      expect(screen.queryByText('tools.mcp.server.modal.parameters')).not.toBeInTheDocument()
    })

    it('should render parameters when provided', () => {
      render(
        <MCPServerModal
          appID="app-1"
          latestParams={mockParams}
          show={true}
          onHide={mockOnHide}
        />,
      )

      expect(screen.getByText('tools.mcp.server.modal.parameters')).toBeInTheDocument()
      expect(screen.getByTestId('param-api_key')).toBeInTheDocument()
      expect(screen.getByTestId('param-secret')).toBeInTheDocument()
    })

    it('should allow changing parameter values', async () => {
      render(
        <MCPServerModal
          appID="app-1"
          latestParams={mockParams}
          show={true}
          onHide={mockOnHide}
        />,
      )

      const apiKeyInput = screen.getByTestId('param-input-api_key')

      await act(async () => {
        fireEvent.change(apiKeyInput, { target: { value: 'my-api-key' } })
        vi.advanceTimersByTime(10)
      })

      expect(apiKeyInput).toHaveValue('my-api-key')
    })

    it('should pre-fill parameter values from data', () => {
      render(
        <MCPServerModal
          appID="app-1"
          latestParams={mockParams}
          data={{ id: 'server-1', description: 'test', parameters: { api_key: 'existing-key', secret: 'existing-secret' } } as unknown as MockData}
          show={true}
          onHide={mockOnHide}
        />,
      )

      const apiKeyInput = screen.getByTestId('param-input-api_key')
      const secretInput = screen.getByTestId('param-input-secret')

      expect(apiKeyInput).toHaveValue('existing-key')
      expect(secretInput).toHaveValue('existing-secret')
    })

    it('should submit with parameter values', async () => {
      render(
        <MCPServerModal
          appID="app-1"
          latestParams={mockParams}
          show={true}
          onHide={mockOnHide}
        />,
      )

      const textarea = screen.getByPlaceholderText('tools.mcp.server.modal.descriptionPlaceholder')
      const apiKeyInput = screen.getByTestId('param-input-api_key')
      const secretInput = screen.getByTestId('param-input-secret')

      await act(async () => {
        fireEvent.change(textarea, { target: { value: 'Test description' } })
        fireEvent.change(apiKeyInput, { target: { value: 'test-api-key' } })
        fireEvent.change(secretInput, { target: { value: 'test-secret' } })
        vi.advanceTimersByTime(10)
      })

      const submitBtn = screen.getByText('tools.mcp.server.modal.confirm')

      await act(async () => {
        fireEvent.click(submitBtn)
        vi.advanceTimersByTime(10)
      })

      expect(mockCreateMCPServer).toHaveBeenCalledWith({
        appID: 'app-1',
        description: 'Test description',
        parameters: { api_key: 'test-api-key', secret: 'test-secret' },
      })
    })
  })

  describe('Form Submission', () => {
    it('should disable submit button when description is empty', () => {
      render(
        <MCPServerModal
          appID="app-1"
          show={true}
          onHide={mockOnHide}
        />,
      )

      const submitBtn = screen.getByText('tools.mcp.server.modal.confirm')
      expect(submitBtn).toBeDisabled()
    })

    it('should enable submit button when description is filled', async () => {
      render(
        <MCPServerModal
          appID="app-1"
          show={true}
          onHide={mockOnHide}
        />,
      )

      const textarea = screen.getByRole('textbox')

      await act(async () => {
        fireEvent.change(textarea, { target: { value: 'Test description' } })
        vi.advanceTimersByTime(10)
      })

      const submitBtn = screen.getByText('tools.mcp.server.modal.confirm')
      expect(submitBtn).not.toBeDisabled()
    })

    it('should call createMCPServer when submitting new server', async () => {
      render(
        <MCPServerModal
          appID="app-1"
          show={true}
          onHide={mockOnHide}
        />,
      )

      const textarea = screen.getByRole('textbox')

      await act(async () => {
        fireEvent.change(textarea, { target: { value: 'Test description' } })
        vi.advanceTimersByTime(10)
      })

      const submitBtn = screen.getByText('tools.mcp.server.modal.confirm')

      await act(async () => {
        fireEvent.click(submitBtn)
        vi.advanceTimersByTime(10)
      })

      expect(mockCreateMCPServer).toHaveBeenCalledWith({
        appID: 'app-1',
        description: 'Test description',
        parameters: {},
      })
    })

    it('should call updateMCPServer when editing existing server', async () => {
      render(
        <MCPServerModal
          appID="app-1"
          data={{ id: 'server-1', description: 'Old description' } as unknown as MockData}
          show={true}
          onHide={mockOnHide}
        />,
      )

      const textarea = screen.getByRole('textbox')

      await act(async () => {
        fireEvent.change(textarea, { target: { value: 'Updated description' } })
        vi.advanceTimersByTime(10)
      })

      const submitBtn = screen.getByText('tools.mcp.modal.save')

      await act(async () => {
        fireEvent.click(submitBtn)
        vi.advanceTimersByTime(10)
      })

      expect(mockUpdateMCPServer).toHaveBeenCalledWith({
        appID: 'app-1',
        id: 'server-1',
        description: 'Updated description',
        parameters: {},
      })
    })
  })

  describe('Cancel', () => {
    it('should call onHide when cancel button is clicked', async () => {
      render(
        <MCPServerModal
          appID="app-1"
          show={true}
          onHide={mockOnHide}
        />,
      )

      const cancelBtn = screen.getByText('tools.mcp.modal.cancel')

      await act(async () => {
        fireEvent.click(cancelBtn)
        vi.advanceTimersByTime(10)
      })

      expect(mockOnHide).toHaveBeenCalled()
    })

    it('should call onHide when close icon is clicked', async () => {
      render(
        <MCPServerModal
          appID="app-1"
          show={true}
          onHide={mockOnHide}
        />,
      )

      const closeBtn = screen.getByTestId('close-btn')

      await act(async () => {
        fireEvent.click(closeBtn)
        vi.advanceTimersByTime(10)
      })

      expect(mockOnHide).toHaveBeenCalled()
    })
  })
})
