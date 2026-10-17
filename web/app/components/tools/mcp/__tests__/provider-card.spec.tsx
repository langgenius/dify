import type { ReactNode } from 'react'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { render } from '@/test/console/render'
import MCPCard from '../provider-card'

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

  describe('User Interactions', () => {
    it('should call handleSelect when card is clicked', async () => {
      const user = userEvent.setup()
      const handleSelect = vi.fn()
      render(<MCPCard {...defaultProps} handleSelect={handleSelect} />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByRole('button', { name: /Test MCP Server/ }))

      expect(handleSelect).toHaveBeenCalledWith('mcp-1')
    })
  })

  describe('Status Indicator', () => {
    it('should include configured status in the card button name', () => {
      const data = createMockData({ is_team_authorization: true, tools: [{ name: 'tool1' }] })
      render(<MCPCard {...defaultProps} data={data} />, { wrapper: createWrapper() })
      expect(screen.getByRole('button', { name: /tools\.mcp\.configured/ })).toBeInTheDocument()
      expect(screen.queryByText('tools.mcp.noConfigured')).not.toBeInTheDocument()
    })
  })

  describe('Operation Dropdown', () => {
    it('should not render operation dropdown when user lacks mcp.manage', () => {
      mockConsoleState.workspacePermissionKeys = []

      render(<MCPCard {...defaultProps} />, { wrapper: createWrapper() })

      expect(
        screen.queryByRole('button', { name: 'common.operation.more' }),
      ).not.toBeInTheDocument()
    })

    it('should not select the card when clicking the dropdown icon', async () => {
      const user = userEvent.setup()
      const handleSelect = vi.fn()
      render(<MCPCard {...defaultProps} handleSelect={handleSelect} />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByRole('button', { name: 'common.operation.more' }))

      expect(handleSelect).not.toHaveBeenCalled()
    })

    it('should request edit without selecting the card', async () => {
      const user = userEvent.setup()
      const handleSelect = vi.fn()
      const onEdit = vi.fn()
      render(<MCPCard {...defaultProps} handleSelect={handleSelect} onEdit={onEdit} />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
      await user.click(screen.getByRole('menuitem', { name: 'tools.mcp.operation.edit' }))

      expect(onEdit).toHaveBeenCalledWith('mcp-1')
      expect(handleSelect).not.toHaveBeenCalled()
    })
  })

  describe('Delete Action', () => {
    it('should request delete without selecting the card', async () => {
      const user = userEvent.setup()
      const handleSelect = vi.fn()
      const onDelete = vi.fn()
      render(<MCPCard {...defaultProps} handleSelect={handleSelect} onDelete={onDelete} />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
      await user.click(screen.getByRole('menuitem', { name: 'tools.mcp.operation.remove' }))

      expect(onDelete).toHaveBeenCalledWith('mcp-1')
      expect(handleSelect).not.toHaveBeenCalled()
    })
  })
})
