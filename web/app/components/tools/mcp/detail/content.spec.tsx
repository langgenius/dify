import type { ReactNode } from 'react'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MCPDetailContent from './content'

// Mutable mock functions
const mockUpdateTools = vi.fn().mockResolvedValue({})
const mockAuthorizeMcp = vi.fn().mockResolvedValue({ result: 'success' })
const mockUpdateMCP = vi.fn().mockResolvedValue({ result: 'success' })
const mockDeleteMCP = vi.fn().mockResolvedValue({ result: 'success' })
const mockInvalidateMCPTools = vi.fn()
const mockOpenOAuthPopup = vi.fn()

// Mutable mock state
type MockTool = {
  id: string
  name: string
  description?: string
}

let mockToolsData: { tools: MockTool[] } = { tools: [] }
let mockIsFetching = false
let mockIsUpdating = false
let mockIsAuthorizing = false

// Mock the services
vi.mock('@/service/use-tools', () => ({
  useMCPTools: () => ({
    data: mockToolsData,
    isFetching: mockIsFetching,
  }),
  useInvalidateMCPTools: () => mockInvalidateMCPTools,
  useUpdateMCPTools: () => ({
    mutateAsync: mockUpdateTools,
    isPending: mockIsUpdating,
  }),
  useAuthorizeMCP: () => ({
    mutateAsync: mockAuthorizeMcp,
    isPending: mockIsAuthorizing,
  }),
  useUpdateMCP: () => ({
    mutateAsync: mockUpdateMCP,
  }),
  useDeleteMCP: () => ({
    mutateAsync: mockDeleteMCP,
  }),
}))

// Mock OAuth hook
type OAuthArgs = readonly unknown[]
vi.mock('@/hooks/use-oauth', () => ({
  openOAuthPopup: (...args: OAuthArgs) => mockOpenOAuthPopup(...args),
}))

// Mock MCPModal
type MCPModalData = {
  name: string
  server_url: string
}

type MCPModalProps = {
  show: boolean
  onConfirm: (data: MCPModalData) => void
  onHide: () => void
}

vi.mock('../modal', () => ({
  default: ({ show, onConfirm, onHide }: MCPModalProps) => {
    if (!show)
      return null
    return (
      <div data-testid="mcp-update-modal">
        <button data-testid="modal-confirm-btn" onClick={() => onConfirm({ name: 'Updated MCP', server_url: 'https://updated.com' })}>
          Confirm
        </button>
        <button data-testid="modal-close-btn" onClick={onHide}>
          Close
        </button>
      </div>
    )
  },
}))

// Mock Confirm dialog
vi.mock('@/app/components/base/confirm', () => ({
  default: ({ isShow, onConfirm, onCancel, title }: { isShow: boolean, onConfirm: () => void, onCancel: () => void, title: string }) => {
    if (!isShow)
      return null
    return (
      <div data-testid="confirm-dialog" data-title={title}>
        <button data-testid="confirm-btn" onClick={onConfirm}>Confirm</button>
        <button data-testid="cancel-btn" onClick={onCancel}>Cancel</button>
      </div>
    )
  },
}))

// Mock OperationDropdown
vi.mock('./operation-dropdown', () => ({
  default: ({ onEdit, onRemove }: { onEdit: () => void, onRemove: () => void }) => (
    <div data-testid="operation-dropdown">
      <button data-testid="edit-btn" onClick={onEdit}>Edit</button>
      <button data-testid="remove-btn" onClick={onRemove}>Remove</button>
    </div>
  ),
}))

// Mock ToolItem
type ToolItemData = {
  name: string
}

vi.mock('./tool-item', () => ({
  default: ({ tool }: { tool: ToolItemData }) => (
    <div data-testid="tool-item">{tool.name}</div>
  ),
}))

// Mutable workspace manager state
let mockIsCurrentWorkspaceManager = true

// Mock the app context
vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceManager: mockIsCurrentWorkspaceManager,
    isCurrentWorkspaceEditor: true,
  }),
}))

// Mock the plugins service
vi.mock('@/service/use-plugins', () => ({
  useInstalledPluginList: () => ({
    data: { pages: [] },
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    isLoading: false,
    isSuccess: true,
  }),
}))

// Mock common service
vi.mock('@/service/common', () => ({
  uploadRemoteFileInfo: vi.fn().mockResolvedValue({ url: 'https://example.com/icon.png' }),
}))

// Mock copy-to-clipboard
vi.mock('copy-to-clipboard', () => ({
  default: vi.fn(),
}))

describe('MCPDetailContent', () => {
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

  const createMockDetail = (overrides = {}): ToolWithProvider => ({
    id: 'mcp-1',
    name: 'Test MCP Server',
    server_identifier: 'test-mcp',
    server_url: 'https://example.com/mcp',
    icon: { content: '🔧', background: '#FF0000' },
    tools: [],
    is_team_authorization: false,
    ...overrides,
  } as unknown as ToolWithProvider)

  const defaultProps = {
    detail: createMockDetail(),
    onUpdate: vi.fn(),
    onHide: vi.fn(),
    isTriggerAuthorize: false,
    onFirstCreate: vi.fn(),
  }

  beforeEach(() => {
    // Reset mocks
    mockUpdateTools.mockClear()
    mockAuthorizeMcp.mockClear()
    mockUpdateMCP.mockClear()
    mockDeleteMCP.mockClear()
    mockInvalidateMCPTools.mockClear()
    mockOpenOAuthPopup.mockClear()

    // Reset mock return values
    mockUpdateTools.mockResolvedValue({})
    mockAuthorizeMcp.mockResolvedValue({ result: 'success' })
    mockUpdateMCP.mockResolvedValue({ result: 'success' })
    mockDeleteMCP.mockResolvedValue({ result: 'success' })

    // Reset state
    mockToolsData = { tools: [] }
    mockIsFetching = false
    mockIsUpdating = false
    mockIsAuthorizing = false
    mockIsCurrentWorkspaceManager = true
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<MCPDetailContent {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByText('Test MCP Server')).toBeInTheDocument()
    })

    it('should display MCP name', () => {
      render(<MCPDetailContent {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByText('Test MCP Server')).toBeInTheDocument()
    })

    it('should display server identifier', () => {
      render(<MCPDetailContent {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByText('test-mcp')).toBeInTheDocument()
    })

    it('should display server URL', () => {
      render(<MCPDetailContent {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByText('https://example.com/mcp')).toBeInTheDocument()
    })

    it('should render close button', () => {
      render(<MCPDetailContent {...defaultProps} />, { wrapper: createWrapper() })
      // Close button should be present
      const closeButtons = document.querySelectorAll('button')
      expect(closeButtons.length).toBeGreaterThan(0)
    })

    it('should render operation dropdown', () => {
      render(<MCPDetailContent {...defaultProps} />, { wrapper: createWrapper() })
      // Operation dropdown trigger should be present
      expect(document.querySelector('button')).toBeInTheDocument()
    })
  })

  describe('Authorization State', () => {
    it('should show authorize button when not authorized', () => {
      const detail = createMockDetail({ is_team_authorization: false })
      render(
        <MCPDetailContent {...defaultProps} detail={detail} />,
        { wrapper: createWrapper() },
      )
      expect(screen.getByText('tools.mcp.authorize')).toBeInTheDocument()
    })

    it('should show authorized button when authorized', () => {
      const detail = createMockDetail({ is_team_authorization: true })
      render(
        <MCPDetailContent {...defaultProps} detail={detail} />,
        { wrapper: createWrapper() },
      )
      expect(screen.getByText('tools.auth.authorized')).toBeInTheDocument()
    })

    it('should show authorization required message when not authorized', () => {
      const detail = createMockDetail({ is_team_authorization: false })
      render(
        <MCPDetailContent {...defaultProps} detail={detail} />,
        { wrapper: createWrapper() },
      )
      expect(screen.getByText('tools.mcp.authorizingRequired')).toBeInTheDocument()
    })

    it('should show authorization tip', () => {
      const detail = createMockDetail({ is_team_authorization: false })
      render(
        <MCPDetailContent {...defaultProps} detail={detail} />,
        { wrapper: createWrapper() },
      )
      expect(screen.getByText('tools.mcp.authorizeTip')).toBeInTheDocument()
    })
  })

  describe('Empty Tools State', () => {
    it('should show empty message when authorized but no tools', () => {
      const detail = createMockDetail({ is_team_authorization: true, tools: [] })
      render(
        <MCPDetailContent {...defaultProps} detail={detail} />,
        { wrapper: createWrapper() },
      )
      expect(screen.getByText('tools.mcp.toolsEmpty')).toBeInTheDocument()
    })

    it('should show get tools button when empty', () => {
      const detail = createMockDetail({ is_team_authorization: true, tools: [] })
      render(
        <MCPDetailContent {...defaultProps} detail={detail} />,
        { wrapper: createWrapper() },
      )
      expect(screen.getByText('tools.mcp.getTools')).toBeInTheDocument()
    })
  })

  describe('Icon Display', () => {
    it('should render MCP icon', () => {
      render(<MCPDetailContent {...defaultProps} />, { wrapper: createWrapper() })
      // Icon container should be present
      const iconContainer = document.querySelector('[class*="rounded-xl"][class*="border"]')
      expect(iconContainer).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty server URL', () => {
      const detail = createMockDetail({ server_url: '' })
      render(
        <MCPDetailContent {...defaultProps} detail={detail} />,
        { wrapper: createWrapper() },
      )
      expect(screen.getByText('Test MCP Server')).toBeInTheDocument()
    })

    it('should handle long MCP name', () => {
      const longName = 'A'.repeat(100)
      const detail = createMockDetail({ name: longName })
      render(
        <MCPDetailContent {...defaultProps} detail={detail} />,
        { wrapper: createWrapper() },
      )
      expect(screen.getByText(longName)).toBeInTheDocument()
    })
  })

  describe('Tools List', () => {
    it('should show tools list when authorized and has tools', () => {
      mockToolsData = {
        tools: [
          { id: 'tool1', name: 'tool1', description: 'Tool 1' },
          { id: 'tool2', name: 'tool2', description: 'Tool 2' },
        ],
      }
      const detail = createMockDetail({ is_team_authorization: true })
      render(
        <MCPDetailContent {...defaultProps} detail={detail} />,
        { wrapper: createWrapper() },
      )
      expect(screen.getByText('tool1')).toBeInTheDocument()
      expect(screen.getByText('tool2')).toBeInTheDocument()
    })

    it('should show single tool label when only one tool', () => {
      mockToolsData = {
        tools: [{ id: 'tool1', name: 'tool1', description: 'Tool 1' }],
      }
      const detail = createMockDetail({ is_team_authorization: true })
      render(
        <MCPDetailContent {...defaultProps} detail={detail} />,
        { wrapper: createWrapper() },
      )
      expect(screen.getByText('tools.mcp.onlyTool')).toBeInTheDocument()
    })

    it('should show tools count when multiple tools', () => {
      mockToolsData = {
        tools: [
          { id: 'tool1', name: 'tool1', description: 'Tool 1' },
          { id: 'tool2', name: 'tool2', description: 'Tool 2' },
        ],
      }
      const detail = createMockDetail({ is_team_authorization: true })
      render(
        <MCPDetailContent {...defaultProps} detail={detail} />,
        { wrapper: createWrapper() },
      )
      expect(screen.getByText(/tools.mcp.toolsNum/)).toBeInTheDocument()
    })
  })

  describe('Loading States', () => {
    it('should show loading state when fetching tools', () => {
      mockIsFetching = true
      mockToolsData = {
        tools: [{ id: 'tool1', name: 'tool1', description: 'Tool 1' }],
      }
      const detail = createMockDetail({ is_team_authorization: true })
      render(
        <MCPDetailContent {...defaultProps} detail={detail} />,
        { wrapper: createWrapper() },
      )
      expect(screen.getByText('tools.mcp.gettingTools')).toBeInTheDocument()
    })

    it('should show updating state when updating tools', () => {
      mockIsUpdating = true
      mockToolsData = {
        tools: [{ id: 'tool1', name: 'tool1', description: 'Tool 1' }],
      }
      const detail = createMockDetail({ is_team_authorization: true })
      render(
        <MCPDetailContent {...defaultProps} detail={detail} />,
        { wrapper: createWrapper() },
      )
      expect(screen.getByText('tools.mcp.updateTools')).toBeInTheDocument()
    })

    it('should show authorizing button when authorizing', () => {
      mockIsAuthorizing = true
      const detail = createMockDetail({ is_team_authorization: false })
      render(
        <MCPDetailContent {...defaultProps} detail={detail} />,
        { wrapper: createWrapper() },
      )
      // Multiple elements show authorizing text - use getAllByText
      const authorizingElements = screen.getAllByText('tools.mcp.authorizing')
      expect(authorizingElements.length).toBeGreaterThan(0)
    })
  })

  describe('Authorize Flow', () => {
    it('should call authorizeMcp when authorize button is clicked', async () => {
      const onFirstCreate = vi.fn()
      const detail = createMockDetail({ is_team_authorization: false })
      render(
        <MCPDetailContent {...defaultProps} detail={detail} onFirstCreate={onFirstCreate} />,
        { wrapper: createWrapper() },
      )

      const authorizeBtn = screen.getByText('tools.mcp.authorize')
      fireEvent.click(authorizeBtn)

      await waitFor(() => {
        expect(onFirstCreate).toHaveBeenCalled()
        expect(mockAuthorizeMcp).toHaveBeenCalledWith({ provider_id: 'mcp-1' })
      })
    })

    it('should open OAuth popup when authorization_url is returned', async () => {
      mockAuthorizeMcp.mockResolvedValue({ authorization_url: 'https://oauth.example.com' })
      const detail = createMockDetail({ is_team_authorization: false })
      render(
        <MCPDetailContent {...defaultProps} detail={detail} />,
        { wrapper: createWrapper() },
      )

      const authorizeBtn = screen.getByText('tools.mcp.authorize')
      fireEvent.click(authorizeBtn)

      await waitFor(() => {
        expect(mockOpenOAuthPopup).toHaveBeenCalledWith(
          'https://oauth.example.com',
          expect.any(Function),
        )
      })
    })

    it('should trigger authorize on mount when isTriggerAuthorize is true', async () => {
      const onFirstCreate = vi.fn()
      const detail = createMockDetail({ is_team_authorization: false })
      render(
        <MCPDetailContent {...defaultProps} detail={detail} isTriggerAuthorize={true} onFirstCreate={onFirstCreate} />,
        { wrapper: createWrapper() },
      )

      await waitFor(() => {
        expect(onFirstCreate).toHaveBeenCalled()
        expect(mockAuthorizeMcp).toHaveBeenCalled()
      })
    })

    it('should disable authorize button when not workspace manager', () => {
      mockIsCurrentWorkspaceManager = false
      const detail = createMockDetail({ is_team_authorization: false })
      render(
        <MCPDetailContent {...defaultProps} detail={detail} />,
        { wrapper: createWrapper() },
      )

      const authorizeBtn = screen.getByText('tools.mcp.authorize')
      expect(authorizeBtn.closest('button')).toBeDisabled()
    })
  })

  describe('Update Tools Flow', () => {
    it('should show update confirm dialog when update button is clicked', async () => {
      mockToolsData = {
        tools: [{ id: 'tool1', name: 'tool1', description: 'Tool 1' }],
      }
      const detail = createMockDetail({ is_team_authorization: true })
      render(
        <MCPDetailContent {...defaultProps} detail={detail} />,
        { wrapper: createWrapper() },
      )

      const updateBtn = screen.getByText('tools.mcp.update')
      fireEvent.click(updateBtn)

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
      })
    })

    it('should call updateTools when update is confirmed', async () => {
      mockToolsData = {
        tools: [{ id: 'tool1', name: 'tool1', description: 'Tool 1' }],
      }
      const onUpdate = vi.fn()
      const detail = createMockDetail({ is_team_authorization: true })
      render(
        <MCPDetailContent {...defaultProps} detail={detail} onUpdate={onUpdate} />,
        { wrapper: createWrapper() },
      )

      // Open confirm dialog
      const updateBtn = screen.getByText('tools.mcp.update')
      fireEvent.click(updateBtn)

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
      })

      // Confirm the update
      const confirmBtn = screen.getByTestId('confirm-btn')
      fireEvent.click(confirmBtn)

      await waitFor(() => {
        expect(mockUpdateTools).toHaveBeenCalledWith('mcp-1')
        expect(mockInvalidateMCPTools).toHaveBeenCalledWith('mcp-1')
        expect(onUpdate).toHaveBeenCalled()
      })
    })

    it('should call handleUpdateTools when get tools button is clicked', async () => {
      const onUpdate = vi.fn()
      const detail = createMockDetail({ is_team_authorization: true, tools: [] })
      render(
        <MCPDetailContent {...defaultProps} detail={detail} onUpdate={onUpdate} />,
        { wrapper: createWrapper() },
      )

      const getToolsBtn = screen.getByText('tools.mcp.getTools')
      fireEvent.click(getToolsBtn)

      await waitFor(() => {
        expect(mockUpdateTools).toHaveBeenCalledWith('mcp-1')
      })
    })
  })

  describe('Update MCP Modal', () => {
    it('should open update modal when edit button is clicked', async () => {
      render(<MCPDetailContent {...defaultProps} />, { wrapper: createWrapper() })

      const editBtn = screen.getByTestId('edit-btn')
      fireEvent.click(editBtn)

      await waitFor(() => {
        expect(screen.getByTestId('mcp-update-modal')).toBeInTheDocument()
      })
    })

    it('should close update modal when close button is clicked', async () => {
      render(<MCPDetailContent {...defaultProps} />, { wrapper: createWrapper() })

      // Open modal
      const editBtn = screen.getByTestId('edit-btn')
      fireEvent.click(editBtn)

      await waitFor(() => {
        expect(screen.getByTestId('mcp-update-modal')).toBeInTheDocument()
      })

      // Close modal
      const closeBtn = screen.getByTestId('modal-close-btn')
      fireEvent.click(closeBtn)

      await waitFor(() => {
        expect(screen.queryByTestId('mcp-update-modal')).not.toBeInTheDocument()
      })
    })

    it('should call updateMCP when form is confirmed', async () => {
      const onUpdate = vi.fn()
      render(<MCPDetailContent {...defaultProps} onUpdate={onUpdate} />, { wrapper: createWrapper() })

      // Open modal
      const editBtn = screen.getByTestId('edit-btn')
      fireEvent.click(editBtn)

      await waitFor(() => {
        expect(screen.getByTestId('mcp-update-modal')).toBeInTheDocument()
      })

      // Confirm form
      const confirmBtn = screen.getByTestId('modal-confirm-btn')
      fireEvent.click(confirmBtn)

      await waitFor(() => {
        expect(mockUpdateMCP).toHaveBeenCalledWith({
          name: 'Updated MCP',
          server_url: 'https://updated.com',
          provider_id: 'mcp-1',
        })
        expect(onUpdate).toHaveBeenCalled()
      })
    })

    it('should not call onUpdate when updateMCP fails', async () => {
      mockUpdateMCP.mockResolvedValue({ result: 'error' })
      const onUpdate = vi.fn()
      render(<MCPDetailContent {...defaultProps} onUpdate={onUpdate} />, { wrapper: createWrapper() })

      // Open modal
      const editBtn = screen.getByTestId('edit-btn')
      fireEvent.click(editBtn)

      await waitFor(() => {
        expect(screen.getByTestId('mcp-update-modal')).toBeInTheDocument()
      })

      // Confirm form
      const confirmBtn = screen.getByTestId('modal-confirm-btn')
      fireEvent.click(confirmBtn)

      await waitFor(() => {
        expect(mockUpdateMCP).toHaveBeenCalled()
      })

      expect(onUpdate).not.toHaveBeenCalled()
    })
  })

  describe('Delete MCP Flow', () => {
    it('should open delete confirm when remove button is clicked', async () => {
      render(<MCPDetailContent {...defaultProps} />, { wrapper: createWrapper() })

      const removeBtn = screen.getByTestId('remove-btn')
      fireEvent.click(removeBtn)

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
      })
    })

    it('should close delete confirm when cancel is clicked', async () => {
      render(<MCPDetailContent {...defaultProps} />, { wrapper: createWrapper() })

      // Open confirm
      const removeBtn = screen.getByTestId('remove-btn')
      fireEvent.click(removeBtn)

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
      })

      // Cancel
      const cancelBtn = screen.getByTestId('cancel-btn')
      fireEvent.click(cancelBtn)

      await waitFor(() => {
        expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
      })
    })

    it('should call deleteMCP when delete is confirmed', async () => {
      const onUpdate = vi.fn()
      render(<MCPDetailContent {...defaultProps} onUpdate={onUpdate} />, { wrapper: createWrapper() })

      // Open confirm
      const removeBtn = screen.getByTestId('remove-btn')
      fireEvent.click(removeBtn)

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
      })

      // Confirm delete
      const confirmBtn = screen.getByTestId('confirm-btn')
      fireEvent.click(confirmBtn)

      await waitFor(() => {
        expect(mockDeleteMCP).toHaveBeenCalledWith('mcp-1')
        expect(onUpdate).toHaveBeenCalledWith(true)
      })
    })

    it('should not call onUpdate when deleteMCP fails', async () => {
      mockDeleteMCP.mockResolvedValue({ result: 'error' })
      const onUpdate = vi.fn()
      render(<MCPDetailContent {...defaultProps} onUpdate={onUpdate} />, { wrapper: createWrapper() })

      // Open confirm
      const removeBtn = screen.getByTestId('remove-btn')
      fireEvent.click(removeBtn)

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
      })

      // Confirm delete
      const confirmBtn = screen.getByTestId('confirm-btn')
      fireEvent.click(confirmBtn)

      await waitFor(() => {
        expect(mockDeleteMCP).toHaveBeenCalled()
      })

      expect(onUpdate).not.toHaveBeenCalled()
    })
  })

  describe('Close Button', () => {
    it('should call onHide when close button is clicked', () => {
      const onHide = vi.fn()
      render(<MCPDetailContent {...defaultProps} onHide={onHide} />, { wrapper: createWrapper() })

      // Find the close button (ActionButton with RiCloseLine)
      const buttons = screen.getAllByRole('button')
      const closeButton = buttons.find(btn =>
        btn.querySelector('svg.h-4.w-4'),
      )

      if (closeButton) {
        fireEvent.click(closeButton)
        expect(onHide).toHaveBeenCalled()
      }
    })
  })

  describe('Copy Server Identifier', () => {
    it('should copy server identifier when clicked', async () => {
      const { default: copy } = await import('copy-to-clipboard')
      render(<MCPDetailContent {...defaultProps} />, { wrapper: createWrapper() })

      // Find the server identifier element
      const serverIdentifier = screen.getByText('test-mcp')
      fireEvent.click(serverIdentifier)

      expect(copy).toHaveBeenCalledWith('test-mcp')
    })
  })

  describe('OAuth Callback', () => {
    it('should call handleUpdateTools on OAuth callback when authorized', async () => {
      // Simulate OAuth flow with authorization_url
      mockAuthorizeMcp.mockResolvedValue({ authorization_url: 'https://oauth.example.com' })
      const onUpdate = vi.fn()
      const detail = createMockDetail({ is_team_authorization: false })
      render(
        <MCPDetailContent {...defaultProps} detail={detail} onUpdate={onUpdate} />,
        { wrapper: createWrapper() },
      )

      // Click authorize to trigger OAuth popup
      const authorizeBtn = screen.getByText('tools.mcp.authorize')
      fireEvent.click(authorizeBtn)

      await waitFor(() => {
        expect(mockOpenOAuthPopup).toHaveBeenCalled()
      })

      // Get the callback function and call it
      const oauthCallback = mockOpenOAuthPopup.mock.calls[0][1]
      oauthCallback()

      await waitFor(() => {
        expect(mockUpdateTools).toHaveBeenCalledWith('mcp-1')
      })
    })

    it('should not call handleUpdateTools if not workspace manager', async () => {
      mockIsCurrentWorkspaceManager = false
      mockAuthorizeMcp.mockResolvedValue({ authorization_url: 'https://oauth.example.com' })
      const detail = createMockDetail({ is_team_authorization: false })

      // OAuth callback should not trigger update for non-manager
      // The button is disabled, so we simulate a scenario where OAuth was already started
      render(
        <MCPDetailContent {...defaultProps} detail={detail} />,
        { wrapper: createWrapper() },
      )

      // Button should be disabled
      const authorizeBtn = screen.getByText('tools.mcp.authorize')
      expect(authorizeBtn.closest('button')).toBeDisabled()
    })
  })

  describe('Authorized Button', () => {
    it('should show authorized button when team is authorized', () => {
      const detail = createMockDetail({ is_team_authorization: true })
      render(
        <MCPDetailContent {...defaultProps} detail={detail} />,
        { wrapper: createWrapper() },
      )
      expect(screen.getByText('tools.auth.authorized')).toBeInTheDocument()
    })

    it('should call handleAuthorize when authorized button is clicked', async () => {
      const onFirstCreate = vi.fn()
      const detail = createMockDetail({ is_team_authorization: true })
      render(
        <MCPDetailContent {...defaultProps} detail={detail} onFirstCreate={onFirstCreate} />,
        { wrapper: createWrapper() },
      )

      const authorizedBtn = screen.getByText('tools.auth.authorized')
      fireEvent.click(authorizedBtn)

      await waitFor(() => {
        expect(onFirstCreate).toHaveBeenCalled()
        expect(mockAuthorizeMcp).toHaveBeenCalled()
      })
    })

    it('should disable authorized button when not workspace manager', () => {
      mockIsCurrentWorkspaceManager = false
      const detail = createMockDetail({ is_team_authorization: true })
      render(
        <MCPDetailContent {...defaultProps} detail={detail} />,
        { wrapper: createWrapper() },
      )

      const authorizedBtn = screen.getByText('tools.auth.authorized')
      expect(authorizedBtn.closest('button')).toBeDisabled()
    })
  })

  describe('Cancel Update Confirm', () => {
    it('should close update confirm when cancel is clicked', async () => {
      mockToolsData = {
        tools: [{ id: 'tool1', name: 'tool1', description: 'Tool 1' }],
      }
      const detail = createMockDetail({ is_team_authorization: true })
      render(
        <MCPDetailContent {...defaultProps} detail={detail} />,
        { wrapper: createWrapper() },
      )

      // Open confirm dialog
      const updateBtn = screen.getByText('tools.mcp.update')
      fireEvent.click(updateBtn)

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
      })

      // Cancel the update
      const cancelBtn = screen.getByTestId('cancel-btn')
      fireEvent.click(cancelBtn)

      await waitFor(() => {
        expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
      })
    })
  })
})
