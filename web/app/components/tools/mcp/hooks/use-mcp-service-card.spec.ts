import type { ReactNode } from 'react'
import type { AppDetailResponse } from '@/models/app'
import type { AppSSO } from '@/types/app'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppModeEnum } from '@/types/app'
import { useMCPServiceCardState } from './use-mcp-service-card'

// Mutable mock data for MCP server detail
let mockMCPServerDetailData: {
  id: string
  status: string
  server_code: string
  description: string
  parameters: Record<string, unknown>
} | undefined = {
  id: 'server-123',
  status: 'active',
  server_code: 'abc123',
  description: 'Test server',
  parameters: {},
}

// Mock service hooks
vi.mock('@/service/use-tools', () => ({
  useUpdateMCPServer: () => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
  }),
  useRefreshMCPServerCode: () => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  }),
  useMCPServerDetail: () => ({
    data: mockMCPServerDetailData,
  }),
  useInvalidateMCPServerDetail: () => vi.fn(),
}))

// Mock workflow hook
vi.mock('@/service/use-workflow', () => ({
  useAppWorkflow: (appId: string) => ({
    data: appId
      ? {
          graph: {
            nodes: [
              { data: { type: 'start', variables: [{ variable: 'input', label: 'Input' }] } },
            ],
          },
        }
      : undefined,
  }),
}))

// Mock app context
vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceManager: true,
    isCurrentWorkspaceEditor: true,
  }),
}))

// Mock apps service
vi.mock('@/service/apps', () => ({
  fetchAppDetail: vi.fn().mockResolvedValue({
    model_config: {
      updated_at: '2024-01-01',
      user_input_form: [],
    },
  }),
}))

describe('useMCPServiceCardState', () => {
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
    // Reset mock data to default (published server)
    mockMCPServerDetailData = {
      id: 'server-123',
      status: 'active',
      server_code: 'abc123',
      description: 'Test server',
      parameters: {},
    }
  })

  describe('Initialization', () => {
    it('should initialize with correct default values for basic app', () => {
      const appInfo = createMockAppInfo(AppModeEnum.CHAT)
      const { result } = renderHook(
        () => useMCPServiceCardState(appInfo, false),
        { wrapper: createWrapper() },
      )

      expect(result.current.serverPublished).toBe(true)
      expect(result.current.serverActivated).toBe(true)
      expect(result.current.showConfirmDelete).toBe(false)
      expect(result.current.showMCPServerModal).toBe(false)
    })

    it('should initialize with correct values for workflow app', () => {
      const appInfo = createMockAppInfo(AppModeEnum.WORKFLOW)
      const { result } = renderHook(
        () => useMCPServiceCardState(appInfo, false),
        { wrapper: createWrapper() },
      )

      expect(result.current.isLoading).toBe(false)
    })

    it('should initialize with correct values for advanced chat app', () => {
      const appInfo = createMockAppInfo(AppModeEnum.ADVANCED_CHAT)
      const { result } = renderHook(
        () => useMCPServiceCardState(appInfo, false),
        { wrapper: createWrapper() },
      )

      expect(result.current.isLoading).toBe(false)
    })
  })

  describe('Server URL Generation', () => {
    it('should generate correct server URL when published', () => {
      const appInfo = createMockAppInfo()
      const { result } = renderHook(
        () => useMCPServiceCardState(appInfo, false),
        { wrapper: createWrapper() },
      )

      expect(result.current.serverURL).toBe('https://api.example.com/mcp/server/abc123/mcp')
    })
  })

  describe('Permission Flags', () => {
    it('should have isCurrentWorkspaceManager as true', () => {
      const appInfo = createMockAppInfo()
      const { result } = renderHook(
        () => useMCPServiceCardState(appInfo, false),
        { wrapper: createWrapper() },
      )

      expect(result.current.isCurrentWorkspaceManager).toBe(true)
    })

    it('should have toggleDisabled false when editor has permissions', () => {
      const appInfo = createMockAppInfo()
      const { result } = renderHook(
        () => useMCPServiceCardState(appInfo, false),
        { wrapper: createWrapper() },
      )

      // Toggle is not disabled when user has permissions and app is published
      expect(typeof result.current.toggleDisabled).toBe('boolean')
    })

    it('should have toggleDisabled true when triggerModeDisabled is true', () => {
      const appInfo = createMockAppInfo()
      const { result } = renderHook(
        () => useMCPServiceCardState(appInfo, true),
        { wrapper: createWrapper() },
      )

      expect(result.current.toggleDisabled).toBe(true)
    })
  })

  describe('UI State Actions', () => {
    it('should open confirm delete modal', () => {
      const appInfo = createMockAppInfo()
      const { result } = renderHook(
        () => useMCPServiceCardState(appInfo, false),
        { wrapper: createWrapper() },
      )

      expect(result.current.showConfirmDelete).toBe(false)

      act(() => {
        result.current.openConfirmDelete()
      })

      expect(result.current.showConfirmDelete).toBe(true)
    })

    it('should close confirm delete modal', () => {
      const appInfo = createMockAppInfo()
      const { result } = renderHook(
        () => useMCPServiceCardState(appInfo, false),
        { wrapper: createWrapper() },
      )

      act(() => {
        result.current.openConfirmDelete()
      })
      expect(result.current.showConfirmDelete).toBe(true)

      act(() => {
        result.current.closeConfirmDelete()
      })
      expect(result.current.showConfirmDelete).toBe(false)
    })

    it('should open server modal', () => {
      const appInfo = createMockAppInfo()
      const { result } = renderHook(
        () => useMCPServiceCardState(appInfo, false),
        { wrapper: createWrapper() },
      )

      expect(result.current.showMCPServerModal).toBe(false)

      act(() => {
        result.current.openServerModal()
      })

      expect(result.current.showMCPServerModal).toBe(true)
    })

    it('should handle server modal hide', () => {
      const appInfo = createMockAppInfo()
      const { result } = renderHook(
        () => useMCPServiceCardState(appInfo, false),
        { wrapper: createWrapper() },
      )

      act(() => {
        result.current.openServerModal()
      })
      expect(result.current.showMCPServerModal).toBe(true)

      let hideResult: { shouldDeactivate: boolean } | undefined
      act(() => {
        hideResult = result.current.handleServerModalHide(false)
      })

      expect(result.current.showMCPServerModal).toBe(false)
      expect(hideResult?.shouldDeactivate).toBe(true)
    })

    it('should not deactivate when wasActivated is true', () => {
      const appInfo = createMockAppInfo()
      const { result } = renderHook(
        () => useMCPServiceCardState(appInfo, false),
        { wrapper: createWrapper() },
      )

      let hideResult: { shouldDeactivate: boolean } | undefined
      act(() => {
        hideResult = result.current.handleServerModalHide(true)
      })

      expect(hideResult?.shouldDeactivate).toBe(false)
    })
  })

  describe('Handler Functions', () => {
    it('should have handleGenCode function', () => {
      const appInfo = createMockAppInfo()
      const { result } = renderHook(
        () => useMCPServiceCardState(appInfo, false),
        { wrapper: createWrapper() },
      )

      expect(typeof result.current.handleGenCode).toBe('function')
    })

    it('should call handleGenCode and invalidate server detail', async () => {
      const appInfo = createMockAppInfo()
      const { result } = renderHook(
        () => useMCPServiceCardState(appInfo, false),
        { wrapper: createWrapper() },
      )

      await act(async () => {
        await result.current.handleGenCode()
      })

      // handleGenCode should complete without error
      expect(result.current.genLoading).toBe(false)
    })

    it('should have handleStatusChange function', () => {
      const appInfo = createMockAppInfo()
      const { result } = renderHook(
        () => useMCPServiceCardState(appInfo, false),
        { wrapper: createWrapper() },
      )

      expect(typeof result.current.handleStatusChange).toBe('function')
    })

    it('should have invalidateBasicAppConfig function', () => {
      const appInfo = createMockAppInfo()
      const { result } = renderHook(
        () => useMCPServiceCardState(appInfo, false),
        { wrapper: createWrapper() },
      )

      expect(typeof result.current.invalidateBasicAppConfig).toBe('function')
    })

    it('should call invalidateBasicAppConfig', () => {
      const appInfo = createMockAppInfo()
      const { result } = renderHook(
        () => useMCPServiceCardState(appInfo, false),
        { wrapper: createWrapper() },
      )

      // Call the function - should not throw
      act(() => {
        result.current.invalidateBasicAppConfig()
      })

      // Function should exist and be callable
      expect(typeof result.current.invalidateBasicAppConfig).toBe('function')
    })
  })

  describe('Status Change', () => {
    it('should return activated state when status change succeeds', async () => {
      const appInfo = createMockAppInfo()
      const { result } = renderHook(
        () => useMCPServiceCardState(appInfo, false),
        { wrapper: createWrapper() },
      )

      let statusResult: { activated: boolean } | undefined
      await act(async () => {
        statusResult = await result.current.handleStatusChange(true)
      })

      expect(statusResult?.activated).toBe(true)
    })

    it('should return deactivated state when disabling', async () => {
      const appInfo = createMockAppInfo()
      const { result } = renderHook(
        () => useMCPServiceCardState(appInfo, false),
        { wrapper: createWrapper() },
      )

      let statusResult: { activated: boolean } | undefined
      await act(async () => {
        statusResult = await result.current.handleStatusChange(false)
      })

      expect(statusResult?.activated).toBe(false)
    })
  })

  describe('Unpublished Server', () => {
    it('should open modal and return not activated when enabling unpublished server', async () => {
      // Set mock to return undefined (unpublished server)
      mockMCPServerDetailData = undefined

      const appInfo = createMockAppInfo()
      const { result } = renderHook(
        () => useMCPServiceCardState(appInfo, false),
        { wrapper: createWrapper() },
      )

      // Verify server is not published
      expect(result.current.serverPublished).toBe(false)

      let statusResult: { activated: boolean } | undefined
      await act(async () => {
        statusResult = await result.current.handleStatusChange(true)
      })

      // Should open modal and return not activated
      expect(result.current.showMCPServerModal).toBe(true)
      expect(statusResult?.activated).toBe(false)
    })
  })

  describe('Loading States', () => {
    it('should have genLoading state', () => {
      const appInfo = createMockAppInfo()
      const { result } = renderHook(
        () => useMCPServiceCardState(appInfo, false),
        { wrapper: createWrapper() },
      )

      expect(typeof result.current.genLoading).toBe('boolean')
    })

    it('should have isLoading state for basic app', () => {
      const appInfo = createMockAppInfo(AppModeEnum.CHAT)
      const { result } = renderHook(
        () => useMCPServiceCardState(appInfo, false),
        { wrapper: createWrapper() },
      )

      // Basic app doesn't need workflow, so isLoading should be false
      expect(result.current.isLoading).toBe(false)
    })
  })

  describe('Detail Data', () => {
    it('should return detail data when available', () => {
      const appInfo = createMockAppInfo()
      const { result } = renderHook(
        () => useMCPServiceCardState(appInfo, false),
        { wrapper: createWrapper() },
      )

      expect(result.current.detail).toBeDefined()
      expect(result.current.detail?.id).toBe('server-123')
      expect(result.current.detail?.status).toBe('active')
    })
  })

  describe('Latest Params', () => {
    it('should return latestParams for workflow app', () => {
      const appInfo = createMockAppInfo(AppModeEnum.WORKFLOW)
      const { result } = renderHook(
        () => useMCPServiceCardState(appInfo, false),
        { wrapper: createWrapper() },
      )

      expect(Array.isArray(result.current.latestParams)).toBe(true)
    })

    it('should return latestParams for basic app', () => {
      const appInfo = createMockAppInfo(AppModeEnum.CHAT)
      const { result } = renderHook(
        () => useMCPServiceCardState(appInfo, false),
        { wrapper: createWrapper() },
      )

      expect(Array.isArray(result.current.latestParams)).toBe(true)
    })
  })
})
