import type { ReactNode } from 'react'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MCPCard from './provider-card'

// Mutable mock functions
const mockUpdateMCP = vi.fn().mockResolvedValue({ result: 'success' })
const mockDeleteMCP = vi.fn().mockResolvedValue({ result: 'success' })

// Mock the services
vi.mock('@/service/use-tools', () => ({
  useUpdateMCP: () => ({
    mutateAsync: mockUpdateMCP,
  }),
  useDeleteMCP: () => ({
    mutateAsync: mockDeleteMCP,
  }),
}))

// Mock the MCPModal
type MCPModalForm = {
  name: string
  server_url: string
}

type MCPModalProps = {
  show: boolean
  onConfirm: (form: MCPModalForm) => void
  onHide: () => void
}

vi.mock('./modal', () => ({
  default: ({ show, onConfirm, onHide }: MCPModalProps) => {
    if (!show)
      return null
    return (
      <div data-testid="mcp-modal">
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

// Mock the Confirm dialog
type ConfirmDialogProps = {
  isShow: boolean
  onConfirm: () => void
  onCancel: () => void
  isLoading: boolean
}

vi.mock('@/app/components/base/confirm', () => ({
  default: ({ isShow, onConfirm, onCancel, isLoading }: ConfirmDialogProps) => {
    if (!isShow)
      return null
    return (
      <div data-testid="confirm-dialog">
        <button data-testid="confirm-delete-btn" onClick={onConfirm} disabled={isLoading}>
          {isLoading ? 'Deleting...' : 'Confirm Delete'}
        </button>
        <button data-testid="cancel-delete-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    )
  },
}))

// Mock the OperationDropdown
type OperationDropdownProps = {
  onEdit: () => void
  onRemove: () => void
  onOpenChange: (open: boolean) => void
}

vi.mock('./detail/operation-dropdown', () => ({
  default: ({ onEdit, onRemove, onOpenChange }: OperationDropdownProps) => (
    <div data-testid="operation-dropdown">
      <button
        data-testid="edit-btn"
        onClick={() => {
          onOpenChange(true)
          onEdit()
        }}
      >
        Edit
      </button>
      <button
        data-testid="remove-btn"
        onClick={() => {
          onOpenChange(true)
          onRemove()
        }}
      >
        Remove
      </button>
    </div>
  ),
}))

// Mock the app context
vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceManager: true,
    isCurrentWorkspaceEditor: true,
  }),
}))

// Mock the format time hook
vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: (_timestamp: number) => '2 hours ago',
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

describe('MCPCard', () => {
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

  const createMockData = (overrides = {}): ToolWithProvider => ({
    id: 'mcp-1',
    name: 'Test MCP Server',
    server_identifier: 'test-server',
    icon: { content: '🔧', background: '#FF0000' },
    tools: [
      { name: 'tool1', description: 'Tool 1' },
      { name: 'tool2', description: 'Tool 2' },
    ],
    is_team_authorization: true,
    updated_at: Date.now() / 1000,
    ...overrides,
  } as unknown as ToolWithProvider)

  const defaultProps = {
    data: createMockData(),
    handleSelect: vi.fn(),
    onUpdate: vi.fn(),
    onDeleted: vi.fn(),
  }

  beforeEach(() => {
    mockUpdateMCP.mockClear()
    mockDeleteMCP.mockClear()
    mockUpdateMCP.mockResolvedValue({ result: 'success' })
    mockDeleteMCP.mockResolvedValue({ result: 'success' })
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<MCPCard {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByText('Test MCP Server')).toBeInTheDocument()
    })

    it('should display MCP name', () => {
      render(<MCPCard {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByText('Test MCP Server')).toBeInTheDocument()
    })

    it('should display server identifier', () => {
      render(<MCPCard {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByText('test-server')).toBeInTheDocument()
    })

    it('should display tools count', () => {
      render(<MCPCard {...defaultProps} />, { wrapper: createWrapper() })
      // The tools count uses i18n with count parameter
      expect(screen.getByText(/tools.mcp.toolsCount/)).toBeInTheDocument()
    })

    it('should display update time', () => {
      render(<MCPCard {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByText(/tools.mcp.updateTime/)).toBeInTheDocument()
    })
  })

  describe('No Tools State', () => {
    it('should show no tools message when tools array is empty', () => {
      const dataWithNoTools = createMockData({ tools: [] })
      render(
        <MCPCard {...defaultProps} data={dataWithNoTools} />,
        { wrapper: createWrapper() },
      )
      expect(screen.getByText('tools.mcp.noTools')).toBeInTheDocument()
    })

    it('should show not configured badge when not authorized', () => {
      const dataNotAuthorized = createMockData({ is_team_authorization: false })
      render(
        <MCPCard {...defaultProps} data={dataNotAuthorized} />,
        { wrapper: createWrapper() },
      )
      expect(screen.getByText('tools.mcp.noConfigured')).toBeInTheDocument()
    })

    it('should show not configured badge when no tools', () => {
      const dataWithNoTools = createMockData({ tools: [], is_team_authorization: true })
      render(
        <MCPCard {...defaultProps} data={dataWithNoTools} />,
        { wrapper: createWrapper() },
      )
      expect(screen.getByText('tools.mcp.noConfigured')).toBeInTheDocument()
    })
  })

  describe('Selected State', () => {
    it('should apply selected styles when current provider matches', () => {
      render(
        <MCPCard {...defaultProps} currentProvider={defaultProps.data} />,
        { wrapper: createWrapper() },
      )
      const card = document.querySelector('[class*="border-components-option-card-option-selected-border"]')
      expect(card).toBeInTheDocument()
    })

    it('should not apply selected styles when different provider', () => {
      const differentProvider = createMockData({ id: 'different-id' })
      render(
        <MCPCard {...defaultProps} currentProvider={differentProvider} />,
        { wrapper: createWrapper() },
      )
      const card = document.querySelector('[class*="border-components-option-card-option-selected-border"]')
      expect(card).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call handleSelect when card is clicked', () => {
      const handleSelect = vi.fn()
      render(
        <MCPCard {...defaultProps} handleSelect={handleSelect} />,
        { wrapper: createWrapper() },
      )

      const card = screen.getByText('Test MCP Server').closest('[class*="cursor-pointer"]')
      if (card) {
        fireEvent.click(card)
        expect(handleSelect).toHaveBeenCalledWith('mcp-1')
      }
    })
  })

  describe('Card Icon', () => {
    it('should render card icon', () => {
      render(<MCPCard {...defaultProps} />, { wrapper: createWrapper() })
      // Icon component is rendered
      const iconContainer = document.querySelector('[class*="rounded-xl"][class*="border"]')
      expect(iconContainer).toBeInTheDocument()
    })
  })

  describe('Status Indicator', () => {
    it('should show green indicator when authorized and has tools', () => {
      const data = createMockData({ is_team_authorization: true, tools: [{ name: 'tool1' }] })
      render(
        <MCPCard {...defaultProps} data={data} />,
        { wrapper: createWrapper() },
      )
      // Should have green indicator (not showing red badge)
      expect(screen.queryByText('tools.mcp.noConfigured')).not.toBeInTheDocument()
    })

    it('should show red indicator when not configured', () => {
      const data = createMockData({ is_team_authorization: false })
      render(
        <MCPCard {...defaultProps} data={data} />,
        { wrapper: createWrapper() },
      )
      expect(screen.getByText('tools.mcp.noConfigured')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle long MCP name', () => {
      const longName = 'A'.repeat(100)
      const data = createMockData({ name: longName })
      render(
        <MCPCard {...defaultProps} data={data} />,
        { wrapper: createWrapper() },
      )
      expect(screen.getByText(longName)).toBeInTheDocument()
    })

    it('should handle special characters in name', () => {
      const data = createMockData({ name: 'Test <Script> & "Quotes"' })
      render(
        <MCPCard {...defaultProps} data={data} />,
        { wrapper: createWrapper() },
      )
      expect(screen.getByText('Test <Script> & "Quotes"')).toBeInTheDocument()
    })

    it('should handle undefined currentProvider', () => {
      render(
        <MCPCard {...defaultProps} currentProvider={undefined} />,
        { wrapper: createWrapper() },
      )
      expect(screen.getByText('Test MCP Server')).toBeInTheDocument()
    })
  })

  describe('Operation Dropdown', () => {
    it('should render operation dropdown for workspace managers', () => {
      render(<MCPCard {...defaultProps} />, { wrapper: createWrapper() })

      expect(screen.getByTestId('operation-dropdown')).toBeInTheDocument()
    })

    it('should stop propagation when clicking on dropdown container', () => {
      const handleSelect = vi.fn()
      render(<MCPCard {...defaultProps} handleSelect={handleSelect} />, { wrapper: createWrapper() })

      // Click on the dropdown area (which should stop propagation)
      const dropdown = screen.getByTestId('operation-dropdown')
      const dropdownContainer = dropdown.closest('[class*="absolute"]')
      if (dropdownContainer) {
        fireEvent.click(dropdownContainer)
        // handleSelect should NOT be called because stopPropagation
        expect(handleSelect).not.toHaveBeenCalled()
      }
    })
  })

  describe('Update Modal', () => {
    it('should open update modal when edit button is clicked', async () => {
      render(<MCPCard {...defaultProps} />, { wrapper: createWrapper() })

      // Click the edit button
      const editBtn = screen.getByTestId('edit-btn')
      fireEvent.click(editBtn)

      // Modal should be shown
      await waitFor(() => {
        expect(screen.getByTestId('mcp-modal')).toBeInTheDocument()
      })
    })

    it('should close update modal when close button is clicked', async () => {
      render(<MCPCard {...defaultProps} />, { wrapper: createWrapper() })

      // Open the modal
      const editBtn = screen.getByTestId('edit-btn')
      fireEvent.click(editBtn)

      await waitFor(() => {
        expect(screen.getByTestId('mcp-modal')).toBeInTheDocument()
      })

      // Close the modal
      const closeBtn = screen.getByTestId('modal-close-btn')
      fireEvent.click(closeBtn)

      await waitFor(() => {
        expect(screen.queryByTestId('mcp-modal')).not.toBeInTheDocument()
      })
    })

    it('should call updateMCP and onUpdate when form is confirmed', async () => {
      const onUpdate = vi.fn()
      render(<MCPCard {...defaultProps} onUpdate={onUpdate} />, { wrapper: createWrapper() })

      // Open the modal
      const editBtn = screen.getByTestId('edit-btn')
      fireEvent.click(editBtn)

      await waitFor(() => {
        expect(screen.getByTestId('mcp-modal')).toBeInTheDocument()
      })

      // Confirm the form
      const confirmBtn = screen.getByTestId('modal-confirm-btn')
      fireEvent.click(confirmBtn)

      await waitFor(() => {
        expect(mockUpdateMCP).toHaveBeenCalledWith({
          name: 'Updated MCP',
          server_url: 'https://updated.com',
          provider_id: 'mcp-1',
        })
        expect(onUpdate).toHaveBeenCalledWith('mcp-1')
      })
    })

    it('should not call onUpdate when updateMCP fails', async () => {
      mockUpdateMCP.mockResolvedValue({ result: 'error' })
      const onUpdate = vi.fn()
      render(<MCPCard {...defaultProps} onUpdate={onUpdate} />, { wrapper: createWrapper() })

      // Open the modal
      const editBtn = screen.getByTestId('edit-btn')
      fireEvent.click(editBtn)

      await waitFor(() => {
        expect(screen.getByTestId('mcp-modal')).toBeInTheDocument()
      })

      // Confirm the form
      const confirmBtn = screen.getByTestId('modal-confirm-btn')
      fireEvent.click(confirmBtn)

      await waitFor(() => {
        expect(mockUpdateMCP).toHaveBeenCalled()
      })

      // onUpdate should not be called because result is not 'success'
      expect(onUpdate).not.toHaveBeenCalled()
    })
  })

  describe('Delete Confirm', () => {
    it('should open delete confirm when remove button is clicked', async () => {
      render(<MCPCard {...defaultProps} />, { wrapper: createWrapper() })

      // Click the remove button
      const removeBtn = screen.getByTestId('remove-btn')
      fireEvent.click(removeBtn)

      // Confirm dialog should be shown
      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
      })
    })

    it('should close delete confirm when cancel button is clicked', async () => {
      render(<MCPCard {...defaultProps} />, { wrapper: createWrapper() })

      // Open the confirm dialog
      const removeBtn = screen.getByTestId('remove-btn')
      fireEvent.click(removeBtn)

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
      })

      // Cancel
      const cancelBtn = screen.getByTestId('cancel-delete-btn')
      fireEvent.click(cancelBtn)

      await waitFor(() => {
        expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
      })
    })

    it('should call deleteMCP and onDeleted when delete is confirmed', async () => {
      const onDeleted = vi.fn()
      render(<MCPCard {...defaultProps} onDeleted={onDeleted} />, { wrapper: createWrapper() })

      // Open the confirm dialog
      const removeBtn = screen.getByTestId('remove-btn')
      fireEvent.click(removeBtn)

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
      })

      // Confirm delete
      const confirmBtn = screen.getByTestId('confirm-delete-btn')
      fireEvent.click(confirmBtn)

      await waitFor(() => {
        expect(mockDeleteMCP).toHaveBeenCalledWith('mcp-1')
        expect(onDeleted).toHaveBeenCalled()
      })
    })

    it('should not call onDeleted when deleteMCP fails', async () => {
      mockDeleteMCP.mockResolvedValue({ result: 'error' })
      const onDeleted = vi.fn()
      render(<MCPCard {...defaultProps} onDeleted={onDeleted} />, { wrapper: createWrapper() })

      // Open the confirm dialog
      const removeBtn = screen.getByTestId('remove-btn')
      fireEvent.click(removeBtn)

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
      })

      // Confirm delete
      const confirmBtn = screen.getByTestId('confirm-delete-btn')
      fireEvent.click(confirmBtn)

      await waitFor(() => {
        expect(mockDeleteMCP).toHaveBeenCalled()
      })

      // onDeleted should not be called because result is not 'success'
      expect(onDeleted).not.toHaveBeenCalled()
    })
  })
})
