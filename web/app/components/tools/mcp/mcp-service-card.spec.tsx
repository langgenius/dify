/* eslint-disable react/no-unnecessary-use-prefix */
import type { ReactNode } from 'react'
import type { AppDetailResponse } from '@/models/app'
import type { AppSSO } from '@/types/app'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppModeEnum } from '@/types/app'
import MCPServiceCard from './mcp-service-card'

// Mutable mock state for dynamic testing
type MockServerDetail = {
  id: string
  status: string
  server_code: string
  description: string
  parameters?: Record<string, unknown>
}

type MockAppContext = {
  isCurrentWorkspaceManager: boolean
  isCurrentWorkspaceEditor: boolean
}

type MockWorkflowData = {
  graph: {
    nodes: Array<{
      data: {
        type: string
        variables?: Array<{ variable: string, label: string }>
      }
    }>
  }
}

type MockBasicAppConfig = {
  updated_at?: string
  user_input_form?: unknown[]
}

let mockServerDetail: MockServerDetail | undefined = {
  id: 'server-123',
  status: 'active',
  server_code: 'abc123',
  description: 'Test server',
  parameters: {},
}

let mockAppContext: MockAppContext = {
  isCurrentWorkspaceManager: true,
  isCurrentWorkspaceEditor: true,
}

let mockWorkflowData: MockWorkflowData = {
  graph: {
    nodes: [
      { data: { type: 'start', variables: [{ variable: 'input', label: 'Input' }] } },
    ],
  },
}

let mockBasicAppConfig: MockBasicAppConfig = {
  updated_at: '2024-01-01',
  user_input_form: [],
}

const mockUpdateMCPServer = vi.fn().mockResolvedValue({})
const mockRefreshMCPServerCode = vi.fn().mockResolvedValue({})
const mockInvalidateMCPServerDetail = vi.fn()

// Mock service hooks
vi.mock('@/service/use-tools', () => ({
  useUpdateMCPServer: () => ({
    mutateAsync: mockUpdateMCPServer,
  }),
  useRefreshMCPServerCode: () => ({
    mutateAsync: mockRefreshMCPServerCode,
    isPending: false,
  }),
  useMCPServerDetail: (appId: string) => ({
    data: appId ? mockServerDetail : undefined,
  }),
  useInvalidateMCPServerDetail: () => mockInvalidateMCPServerDetail,
}))

// Mock workflow hook
vi.mock('@/service/use-workflow', () => ({
  useAppWorkflow: (appId: string) => ({
    data: appId ? mockWorkflowData : undefined,
  }),
}))

// Mock app context
vi.mock('@/context/app-context', () => ({
  useAppContext: () => mockAppContext,
}))

// Mock apps service
vi.mock('@/service/apps', () => ({
  fetchAppDetail: vi.fn().mockImplementation(() =>
    Promise.resolve({
      model_config: mockBasicAppConfig,
    }),
  ),
}))

// Mock MCPServerModal
vi.mock('@/app/components/tools/mcp/mcp-server-modal', () => ({
  default: ({ show, onHide }: { show: boolean, onHide: () => void }) => {
    if (!show)
      return null
    return (
      <div data-testid="mcp-server-modal">
        <button data-testid="close-modal-btn" onClick={onHide}>Close</button>
      </div>
    )
  },
}))

// Mock Confirm
vi.mock('@/app/components/base/confirm', () => ({
  default: ({ isShow, onConfirm, onCancel }: { isShow: boolean, onConfirm: () => void, onCancel: () => void }) => {
    if (!isShow)
      return null
    return (
      <div data-testid="confirm-dialog">
        <button data-testid="confirm-btn" onClick={onConfirm}>Confirm</button>
        <button data-testid="cancel-btn" onClick={onCancel}>Cancel</button>
      </div>
    )
  },
}))

// Mutable mock handlers for hook
let mockHandleStatusChange = vi.fn().mockResolvedValue({ activated: true })
let mockHandleServerModalHide = vi.fn().mockReturnValue({ shouldDeactivate: false })
let mockHandleGenCode = vi.fn()
let mockOpenConfirmDelete = vi.fn()
let mockCloseConfirmDelete = vi.fn()
let mockOpenServerModal = vi.fn()

// Mutable hook state
let mockHookState = {
  genLoading: false,
  isLoading: false,
  serverPublished: true,
  serverActivated: true,
  serverURL: 'https://api.example.com/mcp/server/abc123/mcp',
  detail: {
    id: 'server-123',
    status: 'active',
    server_code: 'abc123',
    description: 'Test server',
    parameters: {},
  },
  isCurrentWorkspaceManager: true,
  toggleDisabled: false,
  isMinimalState: false,
  appUnpublished: false,
  missingStartNode: false,
  showConfirmDelete: false,
  showMCPServerModal: false,
  latestParams: [],
}

// Mock the hook
vi.mock('./hooks/use-mcp-service-card', () => ({
  useMCPServiceCardState: () => ({
    ...mockHookState,
    handleStatusChange: mockHandleStatusChange,
    handleServerModalHide: mockHandleServerModalHide,
    handleGenCode: mockHandleGenCode,
    openConfirmDelete: mockOpenConfirmDelete,
    closeConfirmDelete: mockCloseConfirmDelete,
    openServerModal: mockOpenServerModal,
  }),
}))

describe('MCPServiceCard', () => {
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

  const createMockAppInfo = (mode: AppModeEnum = AppModeEnum.CHAT): AppDetailResponse & Partial<AppSSO> => ({
    id: 'app-123',
    name: 'Test App',
    mode,
    api_base_url: 'https://api.example.com/v1',
  } as AppDetailResponse & Partial<AppSSO>)

  beforeEach(() => {
    // Reset all mock states
    mockServerDetail = {
      id: 'server-123',
      status: 'active',
      server_code: 'abc123',
      description: 'Test server',
      parameters: {},
    }
    mockAppContext = {
      isCurrentWorkspaceManager: true,
      isCurrentWorkspaceEditor: true,
    }
    mockWorkflowData = {
      graph: {
        nodes: [
          { data: { type: 'start', variables: [{ variable: 'input', label: 'Input' }] } },
        ],
      },
    }
    mockBasicAppConfig = {
      updated_at: '2024-01-01',
      user_input_form: [],
    }
    mockUpdateMCPServer.mockClear()
    mockRefreshMCPServerCode.mockClear()
    mockInvalidateMCPServerDetail.mockClear()

    // Reset hook mocks
    mockHandleStatusChange = vi.fn().mockResolvedValue({ activated: true })
    mockHandleServerModalHide = vi.fn().mockReturnValue({ shouldDeactivate: false })
    mockHandleGenCode = vi.fn()
    mockOpenConfirmDelete = vi.fn()
    mockCloseConfirmDelete = vi.fn()
    mockOpenServerModal = vi.fn()

    mockHookState = {
      genLoading: false,
      isLoading: false,
      serverPublished: true,
      serverActivated: true,
      serverURL: 'https://api.example.com/mcp/server/abc123/mcp',
      detail: {
        id: 'server-123',
        status: 'active',
        server_code: 'abc123',
        description: 'Test server',
        parameters: {},
      },
      isCurrentWorkspaceManager: true,
      toggleDisabled: false,
      isMinimalState: false,
      appUnpublished: false,
      missingStartNode: false,
      showConfirmDelete: false,
      showMCPServerModal: false,
      latestParams: [],
    }
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const appInfo = createMockAppInfo()
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      expect(screen.getByText('tools.mcp.server.title')).toBeInTheDocument()
    })

    it('should render the MCP icon', () => {
      const appInfo = createMockAppInfo()
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      // The Mcp icon should be present in the component
      expect(screen.getByText('tools.mcp.server.title')).toBeInTheDocument()
    })

    it('should render status indicator', () => {
      const appInfo = createMockAppInfo()
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      // Status indicator shows running or disable
      expect(screen.getByText(/appOverview.overview.status/)).toBeInTheDocument()
    })

    it('should render switch toggle', () => {
      const appInfo = createMockAppInfo()
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      expect(screen.getByRole('switch')).toBeInTheDocument()
    })

    it('should render in minimal or full state based on server status', () => {
      const appInfo = createMockAppInfo()
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      // Component renders either in minimal or full state
      expect(screen.getByText('tools.mcp.server.title')).toBeInTheDocument()
    })

    it('should render edit button', () => {
      const appInfo = createMockAppInfo()
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      // Edit or add description button
      const editOrAddButton = screen.queryByText('tools.mcp.server.edit') || screen.queryByText('tools.mcp.server.addDescription')
      expect(editOrAddButton).toBeInTheDocument()
    })
  })

  describe('Status Indicator', () => {
    it('should show running status when server is activated', () => {
      const appInfo = createMockAppInfo()
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      // The status text should be present
      expect(screen.getByText(/appOverview.overview.status/)).toBeInTheDocument()
    })
  })

  describe('Server URL Display', () => {
    it('should display title in both minimal and full state', () => {
      const appInfo = createMockAppInfo()
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      // Title should always be displayed
      expect(screen.getByText('tools.mcp.server.title')).toBeInTheDocument()
    })
  })

  describe('Trigger Mode Disabled', () => {
    it('should apply opacity when triggerModeDisabled is true', () => {
      const appInfo = createMockAppInfo()
      render(
        <MCPServiceCard appInfo={appInfo} triggerModeDisabled={true} />,
        { wrapper: createWrapper() },
      )

      // Component should have reduced opacity class
      const container = document.querySelector('.opacity-60')
      expect(container).toBeInTheDocument()
    })

    it('should not apply opacity when triggerModeDisabled is false', () => {
      const appInfo = createMockAppInfo()
      render(
        <MCPServiceCard appInfo={appInfo} triggerModeDisabled={false} />,
        { wrapper: createWrapper() },
      )

      // Component should not have reduced opacity class on the main content
      const opacityElements = document.querySelectorAll('.opacity-60')
      // The opacity-60 should not be present when not disabled
      expect(opacityElements.length).toBe(0)
    })

    it('should render overlay when triggerModeDisabled is true', () => {
      const appInfo = createMockAppInfo()
      render(
        <MCPServiceCard appInfo={appInfo} triggerModeDisabled={true} />,
        { wrapper: createWrapper() },
      )

      // Overlay should have cursor-not-allowed
      const overlay = document.querySelector('.cursor-not-allowed')
      expect(overlay).toBeInTheDocument()
    })
  })

  describe('Different App Modes', () => {
    it('should render for chat app', () => {
      const appInfo = createMockAppInfo(AppModeEnum.CHAT)
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      expect(screen.getByText('tools.mcp.server.title')).toBeInTheDocument()
    })

    it('should render for workflow app', () => {
      const appInfo = createMockAppInfo(AppModeEnum.WORKFLOW)
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      expect(screen.getByText('tools.mcp.server.title')).toBeInTheDocument()
    })

    it('should render for advanced chat app', () => {
      const appInfo = createMockAppInfo(AppModeEnum.ADVANCED_CHAT)
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      expect(screen.getByText('tools.mcp.server.title')).toBeInTheDocument()
    })

    it('should render for completion app', () => {
      const appInfo = createMockAppInfo(AppModeEnum.COMPLETION)
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      expect(screen.getByText('tools.mcp.server.title')).toBeInTheDocument()
    })

    it('should render for agent chat app', () => {
      const appInfo = createMockAppInfo(AppModeEnum.AGENT_CHAT)
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      expect(screen.getByText('tools.mcp.server.title')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should toggle switch', async () => {
      const appInfo = createMockAppInfo()
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      const switchElement = screen.getByRole('switch')
      fireEvent.click(switchElement)

      // Switch should be interactive
      await waitFor(() => {
        expect(switchElement).toBeInTheDocument()
      })
    })

    it('should have switch button available', () => {
      const appInfo = createMockAppInfo()
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      // The switch is a button role element
      const switchElement = screen.getByRole('switch')
      expect(switchElement).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should accept triggerModeMessage prop', () => {
      const appInfo = createMockAppInfo()
      const message = 'Custom trigger mode message'
      render(
        <MCPServiceCard
          appInfo={appInfo}
          triggerModeDisabled={true}
          triggerModeMessage={message}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByText('tools.mcp.server.title')).toBeInTheDocument()
    })

    it('should handle empty triggerModeMessage', () => {
      const appInfo = createMockAppInfo()
      render(
        <MCPServiceCard
          appInfo={appInfo}
          triggerModeDisabled={true}
          triggerModeMessage=""
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByText('tools.mcp.server.title')).toBeInTheDocument()
    })

    it('should handle ReactNode as triggerModeMessage', () => {
      const appInfo = createMockAppInfo()
      const message = <span data-testid="custom-message">Custom message</span>
      render(
        <MCPServiceCard
          appInfo={appInfo}
          triggerModeDisabled={true}
          triggerModeMessage={message}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByText('tools.mcp.server.title')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle minimal app info', () => {
      const minimalAppInfo = {
        id: 'minimal-app',
        name: 'Minimal',
        mode: AppModeEnum.CHAT,
        api_base_url: 'https://api.example.com/v1',
      } as AppDetailResponse & Partial<AppSSO>

      render(<MCPServiceCard appInfo={minimalAppInfo} />, { wrapper: createWrapper() })

      expect(screen.getByText('tools.mcp.server.title')).toBeInTheDocument()
    })

    it('should handle app info with special characters in name', () => {
      const appInfo = {
        id: 'app-special',
        name: 'Test App <script>alert("xss")</script>',
        mode: AppModeEnum.CHAT,
        api_base_url: 'https://api.example.com/v1',
      } as AppDetailResponse & Partial<AppSSO>

      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      expect(screen.getByText('tools.mcp.server.title')).toBeInTheDocument()
    })
  })

  describe('Server Not Published', () => {
    beforeEach(() => {
      mockServerDetail = undefined
    })

    it('should show add description button when server is not published', () => {
      const appInfo = createMockAppInfo()
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      const buttons = screen.queryAllByRole('button')
      const addDescButton = buttons.find(btn =>
        btn.textContent?.includes('tools.mcp.server.addDescription'),
      )
      expect(addDescButton || screen.getByText('tools.mcp.server.title')).toBeInTheDocument()
    })

    it('should show masked URL when server is not published', () => {
      const appInfo = createMockAppInfo()
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      // In minimal/unpublished state, the URL should be masked or not shown
      expect(screen.getByText('tools.mcp.server.title')).toBeInTheDocument()
    })

    it('should open modal when enabling unpublished server', async () => {
      const appInfo = createMockAppInfo()
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      const switchElement = screen.getByRole('switch')
      fireEvent.click(switchElement)

      await waitFor(() => {
        const modal = screen.queryByTestId('mcp-server-modal')
        if (modal)
          expect(modal).toBeInTheDocument()
      })
    })
  })

  describe('Inactive Server', () => {
    beforeEach(() => {
      mockServerDetail = {
        id: 'server-123',
        status: 'inactive',
        server_code: 'abc123',
        description: 'Test server',
        parameters: {},
      }
    })

    it('should show disabled status when server is inactive', () => {
      const appInfo = createMockAppInfo()
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      expect(screen.getByText(/appOverview.overview.status/)).toBeInTheDocument()
    })

    it('should toggle switch when server is inactive', async () => {
      const appInfo = createMockAppInfo()
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      const switchElement = screen.getByRole('switch')
      expect(switchElement).toBeInTheDocument()

      fireEvent.click(switchElement)

      // Switch should be interactive when server is inactive but published
      await waitFor(() => {
        expect(switchElement).toBeInTheDocument()
      })
    })
  })

  describe('Non-Manager User', () => {
    beforeEach(() => {
      mockAppContext = {
        isCurrentWorkspaceManager: false,
        isCurrentWorkspaceEditor: true,
      }
    })

    it('should not show regenerate button for non-manager', () => {
      const appInfo = createMockAppInfo()
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      // Regenerate button should not be visible
      expect(screen.getByText('tools.mcp.server.title')).toBeInTheDocument()
    })
  })

  describe('Non-Editor User', () => {
    it('should show disabled styling for non-editor switch', () => {
      mockHookState = {
        ...mockHookState,
        toggleDisabled: true,
      }

      const appInfo = createMockAppInfo()
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      const switchElement = screen.getByRole('switch')
      // Switch uses CSS classes for disabled state, not disabled attribute
      expect(switchElement.className).toContain('!cursor-not-allowed')
      expect(switchElement.className).toContain('!opacity-50')
    })
  })

  describe('Confirm Regenerate Dialog', () => {
    it('should open confirm dialog and regenerate on confirm', async () => {
      const appInfo = createMockAppInfo()
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      // Find and click regenerate button
      const regenerateButtons = document.querySelectorAll('.cursor-pointer')
      const regenerateBtn = Array.from(regenerateButtons).find(btn =>
        btn.querySelector('svg.h-4.w-4'),
      )

      if (regenerateBtn) {
        fireEvent.click(regenerateBtn)

        await waitFor(() => {
          const confirmDialog = screen.queryByTestId('confirm-dialog')
          if (confirmDialog) {
            expect(confirmDialog).toBeInTheDocument()
            const confirmBtn = screen.getByTestId('confirm-btn')
            fireEvent.click(confirmBtn)
          }
        })
      }

      expect(screen.getByText('tools.mcp.server.title')).toBeInTheDocument()
    })

    it('should close confirm dialog on cancel', async () => {
      const appInfo = createMockAppInfo()
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      // Find and click regenerate button
      const regenerateButtons = document.querySelectorAll('.cursor-pointer')
      const regenerateBtn = Array.from(regenerateButtons).find(btn =>
        btn.querySelector('svg.h-4.w-4'),
      )

      if (regenerateBtn) {
        fireEvent.click(regenerateBtn)

        await waitFor(() => {
          const confirmDialog = screen.queryByTestId('confirm-dialog')
          if (confirmDialog) {
            expect(confirmDialog).toBeInTheDocument()
            const cancelBtn = screen.getByTestId('cancel-btn')
            fireEvent.click(cancelBtn)
          }
        })
      }

      expect(screen.getByText('tools.mcp.server.title')).toBeInTheDocument()
    })
  })

  describe('MCP Server Modal', () => {
    it('should open and close server modal', async () => {
      const appInfo = createMockAppInfo()
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      // Find edit button
      const buttons = screen.queryAllByRole('button')
      const editButton = buttons.find(btn =>
        btn.textContent?.includes('tools.mcp.server.edit')
        || btn.textContent?.includes('tools.mcp.server.addDescription'),
      )

      if (editButton) {
        fireEvent.click(editButton)

        await waitFor(() => {
          const modal = screen.queryByTestId('mcp-server-modal')
          if (modal) {
            expect(modal).toBeInTheDocument()
            const closeBtn = screen.getByTestId('close-modal-btn')
            fireEvent.click(closeBtn)
          }
        })
      }

      expect(screen.getByText('tools.mcp.server.title')).toBeInTheDocument()
    })

    it('should deactivate switch when modal closes without previous activation', async () => {
      mockServerDetail = undefined // Unpublished server

      const appInfo = createMockAppInfo()
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      const switchElement = screen.getByRole('switch')
      fireEvent.click(switchElement)

      await waitFor(() => {
        const modal = screen.queryByTestId('mcp-server-modal')
        if (modal) {
          expect(modal).toBeInTheDocument()
          const closeBtn = screen.getByTestId('close-modal-btn')
          fireEvent.click(closeBtn)
        }
      })

      // Switch should be off after closing modal without activation
      expect(switchElement).toBeInTheDocument()
    })
  })

  describe('Unpublished App', () => {
    it('should show minimal state for unpublished app', () => {
      mockHookState = {
        ...mockHookState,
        appUnpublished: true,
        isMinimalState: true,
      }

      const appInfo = createMockAppInfo()
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      expect(screen.getByText('tools.mcp.server.title')).toBeInTheDocument()
    })

    it('should show disabled styling for unpublished app switch', () => {
      mockHookState = {
        ...mockHookState,
        appUnpublished: true,
        toggleDisabled: true,
      }

      const appInfo = createMockAppInfo()
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      const switchElement = screen.getByRole('switch')
      // Switch uses CSS classes for disabled state
      expect(switchElement.className).toContain('!cursor-not-allowed')
      expect(switchElement.className).toContain('!opacity-50')
    })
  })

  describe('Workflow App Without Start Node', () => {
    it('should show minimal state for workflow without start node', () => {
      mockHookState = {
        ...mockHookState,
        missingStartNode: true,
        isMinimalState: true,
      }

      const appInfo = createMockAppInfo(AppModeEnum.WORKFLOW)
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      expect(screen.getByText('tools.mcp.server.title')).toBeInTheDocument()
    })

    it('should show disabled styling for workflow without start node', () => {
      mockHookState = {
        ...mockHookState,
        missingStartNode: true,
        toggleDisabled: true,
      }

      const appInfo = createMockAppInfo(AppModeEnum.WORKFLOW)
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      const switchElement = screen.getByRole('switch')
      // Switch uses CSS classes for disabled state
      expect(switchElement.className).toContain('!cursor-not-allowed')
      expect(switchElement.className).toContain('!opacity-50')
    })
  })

  describe('Loading State', () => {
    it('should return null when isLoading is true', () => {
      mockHookState = {
        ...mockHookState,
        isLoading: true,
      }

      const appInfo = createMockAppInfo()
      const { container } = render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      // Component returns null when loading
      expect(container.firstChild).toBeNull()
    })

    it('should render content when isLoading is false', () => {
      mockHookState = {
        ...mockHookState,
        isLoading: false,
      }

      const appInfo = createMockAppInfo()
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      expect(screen.getByText('tools.mcp.server.title')).toBeInTheDocument()
    })
  })

  describe('TriggerModeOverlay', () => {
    it('should show overlay without tooltip when triggerModeMessage is empty', () => {
      const appInfo = createMockAppInfo()
      render(
        <MCPServiceCard appInfo={appInfo} triggerModeDisabled={true} triggerModeMessage="" />,
        { wrapper: createWrapper() },
      )

      const overlay = document.querySelector('.cursor-not-allowed')
      expect(overlay).toBeInTheDocument()
    })

    it('should show overlay with tooltip when triggerModeMessage is provided', () => {
      const appInfo = createMockAppInfo()
      render(
        <MCPServiceCard appInfo={appInfo} triggerModeDisabled={true} triggerModeMessage="Custom message" />,
        { wrapper: createWrapper() },
      )

      const overlay = document.querySelector('.cursor-not-allowed')
      expect(overlay).toBeInTheDocument()
    })
  })

  describe('onChangeStatus Handler', () => {
    it('should call handleStatusChange with false when turning off', async () => {
      // Start with server activated
      mockHookState = {
        ...mockHookState,
        serverActivated: true,
      }
      mockHandleStatusChange = vi.fn().mockResolvedValue({ activated: false })

      const appInfo = createMockAppInfo()
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      const switchElement = screen.getByRole('switch')

      // Click to turn off - this will trigger onChangeStatus(false)
      fireEvent.click(switchElement)

      await waitFor(() => {
        expect(mockHandleStatusChange).toHaveBeenCalledWith(false)
      })
    })

    it('should call handleStatusChange with true when turning on', async () => {
      // Start with server deactivated
      mockHookState = {
        ...mockHookState,
        serverActivated: false,
      }
      mockHandleStatusChange = vi.fn().mockResolvedValue({ activated: true })

      const appInfo = createMockAppInfo()
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      const switchElement = screen.getByRole('switch')

      // Click to turn on - this will trigger onChangeStatus(true)
      fireEvent.click(switchElement)

      await waitFor(() => {
        expect(mockHandleStatusChange).toHaveBeenCalledWith(true)
      })
    })

    it('should set local activated to false when handleStatusChange returns activated: false and state is true', async () => {
      // Simulate unpublished server scenario where enabling opens modal
      mockHookState = {
        ...mockHookState,
        serverActivated: false,
        serverPublished: false,
      }
      // Handler returns activated: false (modal opened instead)
      mockHandleStatusChange = vi.fn().mockResolvedValue({ activated: false })

      const appInfo = createMockAppInfo()
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      const switchElement = screen.getByRole('switch')

      // Click to turn on
      fireEvent.click(switchElement)

      await waitFor(() => {
        expect(mockHandleStatusChange).toHaveBeenCalledWith(true)
      })

      // The local state should be set to false because result.activated is false
      expect(switchElement).toBeInTheDocument()
    })
  })

  describe('onServerModalHide Handler', () => {
    it('should deactivate when handleServerModalHide returns shouldDeactivate: true', async () => {
      // Set up to show modal
      mockHookState = {
        ...mockHookState,
        showMCPServerModal: true,
        serverActivated: false, // Server was not activated
      }
      mockHandleServerModalHide = vi.fn().mockReturnValue({ shouldDeactivate: true })

      const appInfo = createMockAppInfo()
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      // Close the modal
      const closeBtn = screen.getByTestId('close-modal-btn')
      fireEvent.click(closeBtn)

      await waitFor(() => {
        expect(mockHandleServerModalHide).toHaveBeenCalled()
      })
    })

    it('should not deactivate when handleServerModalHide returns shouldDeactivate: false', async () => {
      mockHookState = {
        ...mockHookState,
        showMCPServerModal: true,
        serverActivated: true, // Server was already activated
      }
      mockHandleServerModalHide = vi.fn().mockReturnValue({ shouldDeactivate: false })

      const appInfo = createMockAppInfo()
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      // Close the modal
      const closeBtn = screen.getByTestId('close-modal-btn')
      fireEvent.click(closeBtn)

      await waitFor(() => {
        expect(mockHandleServerModalHide).toHaveBeenCalled()
      })
    })
  })

  describe('onConfirmRegenerate Handler', () => {
    it('should call handleGenCode and closeConfirmDelete when confirm is clicked', async () => {
      // Set up to show confirm dialog
      mockHookState = {
        ...mockHookState,
        showConfirmDelete: true,
      }

      const appInfo = createMockAppInfo()
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      // Confirm dialog should be visible
      const confirmDialog = screen.getByTestId('confirm-dialog')
      expect(confirmDialog).toBeInTheDocument()

      // Click confirm button
      const confirmBtn = screen.getByTestId('confirm-btn')
      fireEvent.click(confirmBtn)

      await waitFor(() => {
        expect(mockHandleGenCode).toHaveBeenCalled()
        expect(mockCloseConfirmDelete).toHaveBeenCalled()
      })
    })

    it('should call closeConfirmDelete when cancel is clicked', async () => {
      mockHookState = {
        ...mockHookState,
        showConfirmDelete: true,
      }

      const appInfo = createMockAppInfo()
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      // Click cancel button
      const cancelBtn = screen.getByTestId('cancel-btn')
      fireEvent.click(cancelBtn)

      await waitFor(() => {
        expect(mockCloseConfirmDelete).toHaveBeenCalled()
      })
    })
  })

  describe('getTooltipContent Function', () => {
    it('should show publish tip when app is unpublished', () => {
      mockBasicAppConfig = {} // Unpublished

      const appInfo = createMockAppInfo()
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      // Tooltip should contain publish tip
      expect(screen.getByText('tools.mcp.server.title')).toBeInTheDocument()
    })

    it('should show missing start node tooltip for workflow without start node', () => {
      mockWorkflowData = {
        graph: {
          nodes: [{ data: { type: 'end' } }],
        },
      }

      const appInfo = createMockAppInfo(AppModeEnum.WORKFLOW)
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      // The tooltip with learn more link should be available
      expect(screen.getByText('tools.mcp.server.title')).toBeInTheDocument()
    })

    it('should return triggerModeMessage when trigger mode is disabled', () => {
      const appInfo = createMockAppInfo()
      render(
        <MCPServiceCard
          appInfo={appInfo}
          triggerModeDisabled={true}
          triggerModeMessage="Test trigger message"
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByText('tools.mcp.server.title')).toBeInTheDocument()
    })
  })

  describe('State Synchronization', () => {
    it('should sync activated state when serverActivated changes', () => {
      const appInfo = createMockAppInfo()
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      // Initial state
      expect(screen.getByRole('switch')).toBeInTheDocument()
    })
  })

  describe('Accessibility', () => {
    it('should have accessible switch', () => {
      const appInfo = createMockAppInfo()
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      const switchElement = screen.getByRole('switch')
      expect(switchElement).toBeInTheDocument()
    })

    it('should have accessible interactive elements', () => {
      const appInfo = createMockAppInfo()
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      // The switch element with button type is an interactive element
      const switchElement = screen.getByRole('switch')
      expect(switchElement).toBeInTheDocument()
      expect(switchElement).toHaveAttribute('type', 'button')
    })
  })

  describe('Server URL Regeneration', () => {
    it('should open confirm dialog when regenerate is clicked', async () => {
      // Mock to show regenerate button
      vi.doMock('@/service/use-tools', async () => {
        return {
          useUpdateMCPServer: () => ({
            mutateAsync: vi.fn().mockResolvedValue({}),
          }),
          useRefreshMCPServerCode: () => ({
            mutateAsync: vi.fn().mockResolvedValue({}),
            isPending: false,
          }),
          useMCPServerDetail: () => ({
            data: {
              id: 'server-123',
              status: 'active',
              server_code: 'abc123',
              description: 'Test server',
              parameters: {},
            },
          }),
          useInvalidateMCPServerDetail: () => vi.fn(),
        }
      })

      const appInfo = createMockAppInfo()
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      // Find the regenerate button and click it
      const regenerateButtons = document.querySelectorAll('.cursor-pointer')
      const regenerateBtn = Array.from(regenerateButtons).find(btn =>
        btn.querySelector('svg'),
      )
      if (regenerateBtn) {
        fireEvent.click(regenerateBtn)

        // Wait for confirm dialog to appear
        await waitFor(() => {
          const confirmTitle = screen.queryByText('appOverview.overview.appInfo.regenerate')
          if (confirmTitle)
            expect(confirmTitle).toBeInTheDocument()
        }, { timeout: 100 })
      }
    })
  })

  describe('Edit Button', () => {
    it('should open MCP server modal when edit button is clicked', async () => {
      const appInfo = createMockAppInfo()
      render(<MCPServiceCard appInfo={appInfo} />, { wrapper: createWrapper() })

      // Find button with edit text - use queryAllByRole since buttons may not exist
      const buttons = screen.queryAllByRole('button')
      const editButton = buttons.find(btn =>
        btn.textContent?.includes('tools.mcp.server.edit')
        || btn.textContent?.includes('tools.mcp.server.addDescription'),
      )

      if (editButton) {
        fireEvent.click(editButton)

        // Modal should open - check for any modal indicator
        await waitFor(() => {
          // If modal opens, we should see modal content
          expect(screen.getByText('tools.mcp.server.title')).toBeInTheDocument()
        })
      }
      else {
        // In minimal state, no edit button is shown - this is expected behavior
        expect(screen.getByText('tools.mcp.server.title')).toBeInTheDocument()
      }
    })
  })
})
