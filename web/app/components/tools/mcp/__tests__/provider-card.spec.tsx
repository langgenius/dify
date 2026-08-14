import type { ReactNode } from 'react'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, screen } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { render } from '@/test/console/render'
import MCPCard from '../provider-card'

// Mock the OperationDropdown
type OperationDropdownProps = {
  onEdit: () => void
  onRemove: () => void
  onOpenChange: (open: boolean) => void
}

vi.mock('../detail/operation-dropdown', async () => {
  const { createPortal } = await import('react-dom')

  return {
    default: ({ onEdit, onRemove, onOpenChange }: OperationDropdownProps) => (
      <>
        <div data-testid="operation-dropdown">
          <button data-testid="operation-trigger" onClick={() => onOpenChange(true)}>
            <svg data-testid="operation-icon" />
          </button>
        </div>
        {createPortal(
          <>
            <button
              data-testid="edit-btn"
              onClick={() => {
                onOpenChange(false)
                onEdit()
              }}
            >
              Edit
            </button>
            <button
              data-testid="remove-btn"
              onClick={() => {
                onOpenChange(false)
                onRemove()
              }}
            >
              Remove
            </button>
          </>,
          document.body,
        )}
      </>
    ),
  }
})

const mockConsoleState = vi.hoisted(() => ({
  workspacePermissionKeys: ['mcp.manage'] as string[],
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')

  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: mockConsoleState.workspacePermissionKeys,
  }))
})

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

  const createMockData = (overrides = {}): ToolWithProvider =>
    ({
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
    }) as unknown as ToolWithProvider

  const defaultProps = {
    data: createMockData(),
    handleSelect: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
  }

  beforeEach(() => {
    mockConsoleState.workspacePermissionKeys = ['mcp.manage']
  })

  describe('Rendering', () => {
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

    it('should use the Figma card shell', () => {
      render(<MCPCard {...defaultProps} />, { wrapper: createWrapper() })

      const card = screen.getByText('Test MCP Server').closest('.group')
      expect(card).toHaveClass(
        'overflow-hidden',
        'rounded-xl',
        'border-[0.5px]',
        'border-components-panel-border',
        'bg-components-panel-on-panel-item-bg',
        'shadow-xs',
      )
    })

    it('should render footer metadata without a tools icon', () => {
      const { container } = render(<MCPCard {...defaultProps} />, { wrapper: createWrapper() })

      expect(screen.getByText(/tools.mcp.toolsCount/)).toBeInTheDocument()
      expect(screen.getByText(/tools.mcp.updateTime/)).toBeInTheDocument()
      expect(screen.getByText('·')).toBeInTheDocument()
      expect(container.querySelector('.i-ri-hammer-fill')).not.toBeInTheDocument()
    })
  })

  describe('No Tools State', () => {
    it('should show no tools message when tools array is empty', () => {
      const dataWithNoTools = createMockData({ tools: [] })
      render(<MCPCard {...defaultProps} data={dataWithNoTools} />, { wrapper: createWrapper() })
      expect(screen.getByText('tools.mcp.noTools')).toBeInTheDocument()
    })

    it('should show not configured badge when not authorized', () => {
      const dataNotAuthorized = createMockData({ is_team_authorization: false })
      render(<MCPCard {...defaultProps} data={dataNotAuthorized} />, { wrapper: createWrapper() })
      expect(screen.getByText('tools.mcp.noConfigured')).toBeInTheDocument()
    })

    it('should show not configured badge when no tools', () => {
      const dataWithNoTools = createMockData({ tools: [], is_team_authorization: true })
      render(<MCPCard {...defaultProps} data={dataWithNoTools} />, { wrapper: createWrapper() })
      expect(screen.getByText('tools.mcp.noConfigured')).toBeInTheDocument()
    })
  })

  describe('Selected State', () => {
    it('should apply selected styles when current provider matches', () => {
      render(<MCPCard {...defaultProps} currentProvider={defaultProps.data} />, {
        wrapper: createWrapper(),
      })
      const card = document.querySelector(
        '[class*="border-components-option-card-option-selected-border"]',
      )
      expect(card).toBeInTheDocument()
    })

    it('should not apply selected styles when different provider', () => {
      const differentProvider = createMockData({ id: 'different-id' })
      render(<MCPCard {...defaultProps} currentProvider={differentProvider} />, {
        wrapper: createWrapper(),
      })
      const card = document.querySelector(
        '[class*="border-components-option-card-option-selected-border"]',
      )
      expect(card).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call handleSelect when card is clicked', () => {
      const handleSelect = vi.fn()
      render(<MCPCard {...defaultProps} handleSelect={handleSelect} />, {
        wrapper: createWrapper(),
      })

      fireEvent.click(screen.getByRole('button', { name: /Test MCP Server/ }))

      expect(handleSelect).toHaveBeenCalledWith('mcp-1')
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
      render(<MCPCard {...defaultProps} data={data} />, { wrapper: createWrapper() })
      // Should have green indicator (not showing red badge)
      expect(screen.queryByText('tools.mcp.noConfigured')).not.toBeInTheDocument()
    })

    it('should show red indicator when not configured', () => {
      const data = createMockData({ is_team_authorization: false })
      const { container } = render(<MCPCard {...defaultProps} data={data} />, {
        wrapper: createWrapper(),
      })
      expect(screen.getByText('tools.mcp.noConfigured')).toBeInTheDocument()
      expect(container.querySelector('.size-1\\.5')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle long MCP name', () => {
      const longName = 'A'.repeat(100)
      const data = createMockData({ name: longName })
      render(<MCPCard {...defaultProps} data={data} />, { wrapper: createWrapper() })
      expect(screen.getByText(longName)).toBeInTheDocument()
    })

    it('should handle special characters in name', () => {
      const data = createMockData({ name: 'Test <Script> & "Quotes"' })
      render(<MCPCard {...defaultProps} data={data} />, { wrapper: createWrapper() })
      expect(screen.getByText('Test <Script> & "Quotes"')).toBeInTheDocument()
    })

    it('should handle undefined currentProvider', () => {
      render(<MCPCard {...defaultProps} currentProvider={undefined} />, {
        wrapper: createWrapper(),
      })
      expect(screen.getByText('Test MCP Server')).toBeInTheDocument()
    })
  })

  describe('Operation Dropdown', () => {
    it('should render operation dropdown when user has mcp.manage', () => {
      render(<MCPCard {...defaultProps} />, { wrapper: createWrapper() })

      expect(screen.getByTestId('operation-dropdown')).toBeInTheDocument()
    })

    it('should not render operation dropdown when user lacks mcp.manage', () => {
      mockConsoleState.workspacePermissionKeys = []

      render(<MCPCard {...defaultProps} />, { wrapper: createWrapper() })

      expect(screen.queryByTestId('operation-dropdown')).not.toBeInTheDocument()
    })

    it('should not select the card when clicking the dropdown icon', () => {
      const handleSelect = vi.fn()
      render(<MCPCard {...defaultProps} handleSelect={handleSelect} />, {
        wrapper: createWrapper(),
      })

      fireEvent.click(screen.getByTestId('operation-icon'))

      expect(handleSelect).not.toHaveBeenCalled()
    })

    it('should request edit without selecting the card', () => {
      const handleSelect = vi.fn()
      const onEdit = vi.fn()
      render(<MCPCard {...defaultProps} handleSelect={handleSelect} onEdit={onEdit} />, {
        wrapper: createWrapper(),
      })

      fireEvent.click(screen.getByTestId('edit-btn'))

      expect(onEdit).toHaveBeenCalledWith('mcp-1')
      expect(handleSelect).not.toHaveBeenCalled()
    })
  })

  describe('Delete Action', () => {
    it('should request delete without selecting the card', () => {
      const handleSelect = vi.fn()
      const onDelete = vi.fn()
      render(<MCPCard {...defaultProps} handleSelect={handleSelect} onDelete={onDelete} />, {
        wrapper: createWrapper(),
      })

      fireEvent.click(screen.getByTestId('remove-btn'))

      expect(onDelete).toHaveBeenCalledWith('mcp-1')
      expect(handleSelect).not.toHaveBeenCalled()
    })
  })
})
