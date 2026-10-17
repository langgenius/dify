import type { ReactNode } from 'react'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import { render } from '@/test/console/render'
import { createToolProviderFixture } from '@/test/console/tool-provider-fixture'
import { createDeferred } from '@/test/deferred'
import MCPDetailContent from '../content'

// Mutable mock functions
const mockUpdateTools = vi.fn().mockResolvedValue({})
const mockAuthorizeMcp = vi.fn().mockResolvedValue({ result: 'success' })
const mockInvalidateQueries = vi.fn()
const mcpToolsKey = consoleQuery.workspaces.current.tools.mcp.get.queryKey()
const mcpProviderToolsKey =
  consoleQuery.workspaces.current.toolProvider.mcp.tools.byProviderId.get.queryKey({
    input: { params: { provider_id: 'mcp-1' } },
  })
const mockOpenOAuthPopup = vi.fn()

// Mutable mock state
type MockTool = {
  id: string
  name: string
  description?: string
}

let mockToolsData: { tools: MockTool[] } = { tools: [] }
let seedTools = true
const getTools = vi.fn()
const toolsResponse = () =>
  createToolProviderFixture({
    id: 'mcp-1',
    type: 'mcp',
    tools: mockToolsData.tools.map((tool) => ({
      name: tool.name,
      author: 'MCP',
      label: { en_US: tool.name },
      description: { en_US: tool.description ?? '' },
      parameters: [],
    })),
  })

// Mock the services

// Mock OAuth hook
type OAuthArgs = readonly unknown[]
vi.mock('@/hooks/use-oauth', () => ({
  openOAuthPopup: (...args: OAuthArgs) => mockOpenOAuthPopup(...args),
}))

const mockConsoleState = vi.hoisted(() => ({
  workspacePermissionKeys: ['mcp.manage'] as string[],
}))

// Mock the app context

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')

  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: mockConsoleState.workspacePermissionKeys,
  }))
})

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
          staleTime: Infinity,
        },
      },
    })
    if (seedTools)
      queryClient.setQueryData<ReturnType<typeof toolsResponse>>(
        mcpProviderToolsKey,
        toolsResponse(),
      )
    vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(mockInvalidateQueries)
    return ({ children }: { children: ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)
  }

  const getConfirmButton = () => screen.getByRole('button', { name: 'common.operation.confirm' })
  const getCancelButton = () => screen.getByRole('button', { name: 'common.operation.cancel' })

  const createMockDetail = (overrides = {}): ToolWithProvider =>
    ({
      id: 'mcp-1',
      name: 'Test MCP Server',
      server_identifier: 'test-mcp',
      server_url: 'https://example.com/mcp',
      icon: { content: '🔧', background: '#FF0000' },
      tools: [],
      is_team_authorization: false,
      ...overrides,
    }) as unknown as ToolWithProvider

  const defaultProps = {
    detail: createMockDetail(),
    onUpdate: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onHide: vi.fn(),
    isTriggerAuthorize: false,
    onFirstCreate: vi.fn(),
  }

  beforeEach(() => {
    // Reset mocks
    mockUpdateTools.mockClear()
    mockAuthorizeMcp.mockClear()
    mockInvalidateQueries.mockReset().mockResolvedValue(undefined)
    mockOpenOAuthPopup.mockClear()

    // Reset mock return values
    mockUpdateTools.mockResolvedValue({})
    mockAuthorizeMcp.mockResolvedValue({ result: 'success' })

    // Reset state
    mockToolsData = { tools: [] }
    seedTools = true
    getTools.mockReturnValue(new Promise(() => {}))
    mockConsoleState.workspacePermissionKeys = ['mcp.manage']
  })

  describe('Rendering', () => {
    it('should render read-only detail when user lacks mcp.manage', () => {
      mockConsoleState.workspacePermissionKeys = []

      render(<MCPDetailContent {...defaultProps} />, { wrapper: createWrapper() })

      expect(
        screen.queryByRole('button', { name: 'common.operation.more' }),
      ).not.toBeInTheDocument()
      expect(screen.getByText('Test MCP Server')).toBeInTheDocument()
    })
  })

  describe('Empty Tools State', () => {
    it('should show empty message when authorized but no tools', () => {
      const detail = createMockDetail({ is_team_authorization: true, tools: [] })
      render(<MCPDetailContent {...defaultProps} detail={detail} />, { wrapper: createWrapper() })
      expect(screen.getByText('tools.mcp.toolsEmpty'))!.toBeInTheDocument()
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
      render(<MCPDetailContent {...defaultProps} detail={detail} />, { wrapper: createWrapper() })
      expect(screen.getByText('tool1'))!.toBeInTheDocument()
      expect(screen.getByText('tool2'))!.toBeInTheDocument()
    })

    it('should show single tool label when only one tool', () => {
      mockToolsData = {
        tools: [{ id: 'tool1', name: 'tool1', description: 'Tool 1' }],
      }
      const detail = createMockDetail({ is_team_authorization: true })
      render(<MCPDetailContent {...defaultProps} detail={detail} />, { wrapper: createWrapper() })
      expect(screen.getByText('tools.mcp.onlyTool'))!.toBeInTheDocument()
    })
  })

  describe('Loading States', () => {
    it('should show loading state when fetching tools', () => {
      seedTools = false
      mockToolsData = {
        tools: [{ id: 'tool1', name: 'tool1', description: 'Tool 1' }],
      }
      const detail = createMockDetail({ is_team_authorization: true })
      render(<MCPDetailContent {...defaultProps} detail={detail} />, { wrapper: createWrapper() })
      expect(screen.getByText('tools.mcp.gettingTools'))!.toBeInTheDocument()
    })

    it('shows updating state until the update request resolves', async () => {
      const user = userEvent.setup()
      const pending = createDeferred<object>()
      mockUpdateTools.mockReturnValue(pending.promise)
      mockToolsData = { tools: [{ id: 'tool1', name: 'tool1' }] }
      const detail = createMockDetail({ is_team_authorization: true })
      const onUpdate = vi.fn()
      render(<MCPDetailContent {...defaultProps} detail={detail} onUpdate={onUpdate} />, {
        wrapper: createWrapper(),
      })
      await user.click(screen.getByText('tools.mcp.update'))
      await user.click(getConfirmButton())
      expect(await screen.findByText('tools.mcp.updateTools')).toBeInTheDocument()
      expect(onUpdate).not.toHaveBeenCalled()
      await act(async () => pending.resolve({}))
      await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1))
      expect(screen.queryByText('tools.mcp.updateTools')).not.toBeInTheDocument()
    })

    it('shows authorizing state while authorization is pending', async () => {
      const user = userEvent.setup()
      const pending = createDeferred<{ result: string }>()
      mockAuthorizeMcp.mockReturnValue(pending.promise)
      const detail = createMockDetail({ is_team_authorization: false })
      render(<MCPDetailContent {...defaultProps} detail={detail} />, { wrapper: createWrapper() })
      await user.click(screen.getByText('tools.mcp.authorize'))
      expect((await screen.findAllByText('tools.mcp.authorizing')).length).toBeGreaterThan(0)
      await act(async () => pending.resolve({ result: 'success' }))
      await waitFor(() =>
        expect(screen.queryByText('tools.mcp.authorizing')).not.toBeInTheDocument(),
      )
    })
  })

  describe('Authorize Flow', () => {
    it('should call authorizeMcp when authorize button is clicked', async () => {
      const user = userEvent.setup()
      const onFirstCreate = vi.fn()
      const detail = createMockDetail({ is_team_authorization: false })
      render(<MCPDetailContent {...defaultProps} detail={detail} onFirstCreate={onFirstCreate} />, {
        wrapper: createWrapper(),
      })

      const authorizeBtn = screen.getByText('tools.mcp.authorize')
      await user.click(authorizeBtn)

      await waitFor(() => {
        expect(onFirstCreate).toHaveBeenCalled()
        expect(mockAuthorizeMcp).toHaveBeenCalledWith({ body: { provider_id: 'mcp-1' } })
      })
    })

    it('should trigger authorize on mount when isTriggerAuthorize is true', async () => {
      const onFirstCreate = vi.fn()
      const detail = createMockDetail({ is_team_authorization: false })
      render(
        <MCPDetailContent
          {...defaultProps}
          detail={detail}
          isTriggerAuthorize={true}
          onFirstCreate={onFirstCreate}
        />,
        { wrapper: createWrapper() },
      )

      await waitFor(() => {
        expect(onFirstCreate).toHaveBeenCalled()
        expect(mockAuthorizeMcp).toHaveBeenCalled()
      })
    })
  })

  describe('Update Tools Flow', () => {
    it('should call updateTools when update is confirmed', async () => {
      const user = userEvent.setup()
      mockToolsData = {
        tools: [{ id: 'tool1', name: 'tool1', description: 'Tool 1' }],
      }
      const onUpdate = vi.fn()
      const detail = createMockDetail({ is_team_authorization: true })
      render(<MCPDetailContent {...defaultProps} detail={detail} onUpdate={onUpdate} />, {
        wrapper: createWrapper(),
      })

      // Open confirm dialog
      const updateBtn = screen.getByText('tools.mcp.update')
      await user.click(updateBtn)

      await waitFor(() => {
        expect(screen.getByText('tools.mcp.toolUpdateConfirmTitle'))!.toBeInTheDocument()
      })

      // Confirm the update
      await user.click(getConfirmButton())

      await waitFor(() => {
        expect(mockUpdateTools).toHaveBeenCalledWith({ params: { provider_id: 'mcp-1' } })
        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: mcpProviderToolsKey })
        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: mcpToolsKey })
        expect(onUpdate).toHaveBeenCalled()
      })
    })

    it('should call handleUpdateTools when get tools button is clicked', async () => {
      const user = userEvent.setup()
      const onUpdate = vi.fn()
      const detail = createMockDetail({ is_team_authorization: true, tools: [] })
      render(<MCPDetailContent {...defaultProps} detail={detail} onUpdate={onUpdate} />, {
        wrapper: createWrapper(),
      })

      const getToolsBtn = screen.getByText('tools.mcp.getTools')
      await user.click(getToolsBtn)

      await waitFor(() => {
        expect(mockUpdateTools).toHaveBeenCalledWith({ params: { provider_id: 'mcp-1' } })
        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: mcpToolsKey })
      })
    })
  })

  describe('Edit MCP Flow', () => {
    it('should request editing the current provider', async () => {
      const user = userEvent.setup()
      const onEdit = vi.fn()
      render(<MCPDetailContent {...defaultProps} onEdit={onEdit} />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
      await user.click(screen.getByRole('menuitem', { name: 'tools.mcp.operation.edit' }))

      expect(onEdit).toHaveBeenCalledWith('mcp-1')
    })
  })

  describe('Delete MCP Action', () => {
    it('should request delete for the current provider', async () => {
      const user = userEvent.setup()
      const onDelete = vi.fn()
      render(<MCPDetailContent {...defaultProps} onDelete={onDelete} />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
      await user.click(screen.getByRole('menuitem', { name: 'tools.mcp.operation.remove' }))

      expect(onDelete).toHaveBeenCalledWith('mcp-1')
    })
  })

  describe('Close Button', () => {
    it('should call onHide when close button is clicked', async () => {
      const user = userEvent.setup()
      const onHide = vi.fn()
      render(<MCPDetailContent {...defaultProps} onHide={onHide} />, { wrapper: createWrapper() })

      await user.click(screen.getByRole('button', { name: 'common.operation.close' }))

      expect(onHide).toHaveBeenCalled()
    })
  })

  describe('Copy Server Identifier', () => {
    it('should copy server identifier when clicked', async () => {
      const user = userEvent.setup()
      const { default: copy } = await import('copy-to-clipboard')
      render(<MCPDetailContent {...defaultProps} />, { wrapper: createWrapper() })

      const serverIdentifier = screen.getByRole('button', {
        name: /test-mcp.*tools\.mcp\.identifier/,
      })
      await user.click(serverIdentifier)

      expect(copy).toHaveBeenCalledWith('test-mcp')
    })
  })

  describe('OAuth Callback', () => {
    it('should call handleUpdateTools on OAuth callback when authorized', async () => {
      const user = userEvent.setup()
      // Simulate OAuth flow with authorization_url
      mockAuthorizeMcp.mockResolvedValue({ authorization_url: 'https://oauth.example.com' })
      const onUpdate = vi.fn()
      const detail = createMockDetail({ is_team_authorization: false })
      render(<MCPDetailContent {...defaultProps} detail={detail} onUpdate={onUpdate} />, {
        wrapper: createWrapper(),
      })

      // Click authorize to trigger OAuth popup
      const authorizeBtn = screen.getByText('tools.mcp.authorize')
      await user.click(authorizeBtn)

      await waitFor(() => {
        expect(mockOpenOAuthPopup).toHaveBeenCalledWith(
          'https://oauth.example.com',
          expect.any(Function),
        )
      })

      // Get the callback function and call it
      const oauthCallback = mockOpenOAuthPopup.mock.calls[0]![1]
      await act(async () => oauthCallback())

      await waitFor(() => {
        expect(mockUpdateTools).toHaveBeenCalledWith({ params: { provider_id: 'mcp-1' } })
      })
    })

    it('should not run OAuth authorization when user lacks mcp.manage', async () => {
      const user = userEvent.setup()
      mockConsoleState.workspacePermissionKeys = []
      mockAuthorizeMcp.mockResolvedValue({ authorization_url: 'https://oauth.example.com' })
      const detail = createMockDetail({ is_team_authorization: false })

      render(<MCPDetailContent {...defaultProps} detail={detail} />, { wrapper: createWrapper() })

      const authorizeButton = screen.getByText('tools.mcp.authorize').closest('button')!
      expect(authorizeButton).toBeDisabled()
      await user.click(authorizeButton)
      expect(mockAuthorizeMcp).not.toHaveBeenCalled()
    })
  })

  describe('Authorized Button', () => {
    it('should call handleAuthorize when authorized button is clicked', async () => {
      const user = userEvent.setup()
      const onFirstCreate = vi.fn()
      const detail = createMockDetail({ is_team_authorization: true })
      render(<MCPDetailContent {...defaultProps} detail={detail} onFirstCreate={onFirstCreate} />, {
        wrapper: createWrapper(),
      })

      const authorizedBtn = screen.getByText('tools.auth.authorized')
      await user.click(authorizedBtn)

      await waitFor(() => {
        expect(onFirstCreate).toHaveBeenCalled()
        expect(mockAuthorizeMcp).toHaveBeenCalled()
      })
    })

    it('should disable authorized button when user lacks mcp.manage', () => {
      mockConsoleState.workspacePermissionKeys = []
      const detail = createMockDetail({ is_team_authorization: true })
      render(<MCPDetailContent {...defaultProps} detail={detail} />, { wrapper: createWrapper() })

      expect(screen.getByText('tools.auth.authorized').closest('button')).toBeDisabled()
    })
  })

  describe('Cancel Update Confirm', () => {
    it('should close update confirm when cancel is clicked', async () => {
      const user = userEvent.setup()
      mockToolsData = {
        tools: [{ id: 'tool1', name: 'tool1', description: 'Tool 1' }],
      }
      const detail = createMockDetail({ is_team_authorization: true })
      render(<MCPDetailContent {...defaultProps} detail={detail} />, { wrapper: createWrapper() })

      // Open confirm dialog
      const updateBtn = screen.getByText('tools.mcp.update')
      await user.click(updateBtn)

      await waitFor(() => {
        expect(screen.getByText('tools.mcp.toolUpdateConfirmTitle'))!.toBeInTheDocument()
      })

      // Cancel the update
      await user.click(getCancelButton())
      expect(mockUpdateTools).not.toHaveBeenCalled()

      await waitFor(() => {
        expect(screen.queryByText('tools.mcp.toolUpdateConfirmTitle')).not.toBeInTheDocument()
      })
    })
  })
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.toolProvider.mcp.tools.byProviderId.get': (input) => getTools(input),
      'workspaces.current.toolProvider.mcp.update.byProviderId.get': (input) =>
        mockUpdateTools(input),
      'workspaces.current.toolProvider.mcp.auth.post': (input) => mockAuthorizeMcp(input),
    }),
  }
})
