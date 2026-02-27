import type { ReactNode } from 'react'
import type { AppDetailResponse } from '@/models/app'
import type { AppSSO } from '@/types/app'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppModeEnum } from '@/types/app'
import MCPServiceCard from '../mcp-service-card'

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

const mockHandleStatusChange = vi.fn().mockResolvedValue({ activated: true })
const mockHandleServerModalHide = vi.fn().mockReturnValue({ shouldDeactivate: false })
const mockHandleGenCode = vi.fn()
const mockOpenConfirmDelete = vi.fn()
const mockCloseConfirmDelete = vi.fn()
const mockOpenServerModal = vi.fn()

type MockHookState = {
  genLoading: boolean
  isLoading: boolean
  serverPublished: boolean
  serverActivated: boolean
  serverURL: string
  detail: {
    id: string
    status: string
    server_code: string
    description: string
    parameters: Record<string, unknown>
  } | undefined
  isCurrentWorkspaceManager: boolean
  toggleDisabled: boolean
  isMinimalState: boolean
  appUnpublished: boolean
  missingStartNode: boolean
  showConfirmDelete: boolean
  showMCPServerModal: boolean
  latestParams: Array<unknown>
}

const createDefaultHookState = (overrides: Partial<MockHookState> = {}): MockHookState => ({
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
  ...overrides,
})

let mockHookState = createDefaultHookState()

vi.mock('../hooks/use-mcp-service-card', () => ({
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
      defaultOptions: { queries: { retry: false } },
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
    mockHookState = createDefaultHookState()
    mockHandleStatusChange.mockClear().mockResolvedValue({ activated: true })
    mockHandleServerModalHide.mockClear().mockReturnValue({ shouldDeactivate: false })
    mockHandleGenCode.mockClear()
    mockOpenConfirmDelete.mockClear()
    mockCloseConfirmDelete.mockClear()
    mockOpenServerModal.mockClear()
  })

  describe('Rendering', () => {
    it('should render title, status indicator, and switch', () => {
      render(<MCPServiceCard appInfo={createMockAppInfo()} />, { wrapper: createWrapper() })

      expect(screen.getByText('tools.mcp.server.title')).toBeInTheDocument()
      expect(screen.getByText(/appOverview.overview.status/)).toBeInTheDocument()
      expect(screen.getByRole('switch')).toBeInTheDocument()
    })

    it('should render edit button in full state', () => {
      render(<MCPServiceCard appInfo={createMockAppInfo()} />, { wrapper: createWrapper() })

      const editBtn = screen.getByRole('button', { name: /tools\.mcp\.server\.edit/i })
      expect(editBtn).toBeInTheDocument()
    })

    it('should return null when isLoading is true', () => {
      mockHookState = createDefaultHookState({ isLoading: true })

      const { container } = render(<MCPServiceCard appInfo={createMockAppInfo()} />, { wrapper: createWrapper() })
      expect(container.firstChild).toBeNull()
    })

    it('should render content when isLoading is false', () => {
      mockHookState = createDefaultHookState({ isLoading: false })

      render(<MCPServiceCard appInfo={createMockAppInfo()} />, { wrapper: createWrapper() })
      expect(screen.getByText('tools.mcp.server.title')).toBeInTheDocument()
    })
  })

  describe('Different App Modes', () => {
    it.each([
      AppModeEnum.CHAT,
      AppModeEnum.WORKFLOW,
      AppModeEnum.ADVANCED_CHAT,
      AppModeEnum.COMPLETION,
      AppModeEnum.AGENT_CHAT,
    ])('should render for %s app mode', (mode) => {
      render(<MCPServiceCard appInfo={createMockAppInfo(mode)} />, { wrapper: createWrapper() })

      expect(screen.getByText('tools.mcp.server.title')).toBeInTheDocument()
      expect(screen.getByRole('switch')).toBeInTheDocument()
    })
  })

  describe('Trigger Mode Disabled', () => {
    it('should show cursor-not-allowed overlay when triggerModeDisabled is true', () => {
      const { container } = render(
        <MCPServiceCard appInfo={createMockAppInfo()} triggerModeDisabled={true} />,
        { wrapper: createWrapper() },
      )

      const overlay = container.querySelector('.cursor-not-allowed[aria-hidden="true"]')
      expect(overlay).toBeInTheDocument()
    })

    it('should not show cursor-not-allowed overlay when triggerModeDisabled is false', () => {
      const { container } = render(
        <MCPServiceCard appInfo={createMockAppInfo()} triggerModeDisabled={false} />,
        { wrapper: createWrapper() },
      )

      const overlay = container.querySelector('.cursor-not-allowed[aria-hidden="true"]')
      expect(overlay).toBeNull()
    })
  })

  describe('Switch Toggle', () => {
    it('should call handleStatusChange with false when turning off an active server', async () => {
      mockHookState = createDefaultHookState({ serverActivated: true })
      mockHandleStatusChange.mockResolvedValue({ activated: false })

      render(<MCPServiceCard appInfo={createMockAppInfo()} />, { wrapper: createWrapper() })
      fireEvent.click(screen.getByRole('switch'))

      await waitFor(() => {
        expect(mockHandleStatusChange).toHaveBeenCalledWith(false)
      })
    })

    it('should call handleStatusChange with true when turning on an inactive server', async () => {
      mockHookState = createDefaultHookState({ serverActivated: false })
      mockHandleStatusChange.mockResolvedValue({ activated: true })

      render(<MCPServiceCard appInfo={createMockAppInfo()} />, { wrapper: createWrapper() })
      fireEvent.click(screen.getByRole('switch'))

      await waitFor(() => {
        expect(mockHandleStatusChange).toHaveBeenCalledWith(true)
      })
    })

    it('should show disabled styling when toggleDisabled is true', () => {
      mockHookState = createDefaultHookState({ toggleDisabled: true })

      render(<MCPServiceCard appInfo={createMockAppInfo()} />, { wrapper: createWrapper() })

      const switchElement = screen.getByRole('switch')
      expect(switchElement.className).toContain('!cursor-not-allowed')
      expect(switchElement.className).toContain('!opacity-50')
    })
  })

  describe('Server Not Published', () => {
    beforeEach(() => {
      mockHookState = createDefaultHookState({
        serverPublished: false,
        serverActivated: false,
        serverURL: '***********',
        detail: undefined,
        isMinimalState: true,
      })
    })

    it('should render in minimal state without edit button', () => {
      render(<MCPServiceCard appInfo={createMockAppInfo()} />, { wrapper: createWrapper() })

      expect(screen.getByText('tools.mcp.server.title')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /tools\.mcp\.server\.edit/i })).not.toBeInTheDocument()
    })

    it('should open modal when enabling unpublished server', async () => {
      mockHandleStatusChange.mockResolvedValue({ activated: false })

      render(<MCPServiceCard appInfo={createMockAppInfo()} />, { wrapper: createWrapper() })
      fireEvent.click(screen.getByRole('switch'))

      await waitFor(() => {
        expect(mockHandleStatusChange).toHaveBeenCalledWith(true)
      })
    })
  })

  describe('Inactive Server', () => {
    beforeEach(() => {
      mockHookState = createDefaultHookState({
        serverActivated: false,
        detail: {
          id: 'server-123',
          status: 'inactive',
          server_code: 'abc123',
          description: 'Test server',
          parameters: {},
        },
      })
    })

    it('should show disabled status indicator', () => {
      render(<MCPServiceCard appInfo={createMockAppInfo()} />, { wrapper: createWrapper() })

      expect(screen.getByText(/appOverview.overview.status/)).toBeInTheDocument()
    })

    it('should allow toggling switch when server is inactive but published', async () => {
      mockHandleStatusChange.mockResolvedValue({ activated: true })

      render(<MCPServiceCard appInfo={createMockAppInfo()} />, { wrapper: createWrapper() })
      fireEvent.click(screen.getByRole('switch'))

      await waitFor(() => {
        expect(mockHandleStatusChange).toHaveBeenCalledWith(true)
      })
    })
  })

  describe('Confirm Regenerate Dialog', () => {
    it('should call handleGenCode and closeConfirmDelete when confirm is clicked', async () => {
      mockHookState = createDefaultHookState({ showConfirmDelete: true })

      render(<MCPServiceCard appInfo={createMockAppInfo()} />, { wrapper: createWrapper() })

      expect(screen.getByText('appOverview.overview.appInfo.regenerate')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

      await waitFor(() => {
        expect(mockHandleGenCode).toHaveBeenCalled()
        expect(mockCloseConfirmDelete).toHaveBeenCalled()
      })
    })

    it('should call closeConfirmDelete when cancel is clicked', async () => {
      mockHookState = createDefaultHookState({ showConfirmDelete: true })

      render(<MCPServiceCard appInfo={createMockAppInfo()} />, { wrapper: createWrapper() })

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

      await waitFor(() => {
        expect(mockCloseConfirmDelete).toHaveBeenCalled()
        expect(mockHandleGenCode).not.toHaveBeenCalled()
      })
    })
  })

  describe('MCP Server Modal', () => {
    it('should render modal when showMCPServerModal is true', () => {
      mockHookState = createDefaultHookState({ showMCPServerModal: true })

      render(<MCPServiceCard appInfo={createMockAppInfo()} />, { wrapper: createWrapper() })

      expect(screen.getByTestId('mcp-server-modal')).toBeInTheDocument()
    })

    it('should call handleServerModalHide when modal is closed', async () => {
      mockHookState = createDefaultHookState({
        showMCPServerModal: true,
        serverActivated: false,
      })

      render(<MCPServiceCard appInfo={createMockAppInfo()} />, { wrapper: createWrapper() })

      fireEvent.click(screen.getByTestId('close-modal-btn'))

      await waitFor(() => {
        expect(mockHandleServerModalHide).toHaveBeenCalled()
      })
    })

    it('should open modal via edit button click', async () => {
      render(<MCPServiceCard appInfo={createMockAppInfo()} />, { wrapper: createWrapper() })

      const editBtn = screen.getByRole('button', { name: /tools\.mcp\.server\.edit/i })
      fireEvent.click(editBtn)

      expect(mockOpenServerModal).toHaveBeenCalled()
    })
  })

  describe('Unpublished App', () => {
    it('should show minimal state and disabled switch', () => {
      mockHookState = createDefaultHookState({
        appUnpublished: true,
        isMinimalState: true,
        toggleDisabled: true,
      })

      render(<MCPServiceCard appInfo={createMockAppInfo()} />, { wrapper: createWrapper() })

      const switchElement = screen.getByRole('switch')
      expect(switchElement.className).toContain('!cursor-not-allowed')
      expect(switchElement.className).toContain('!opacity-50')
    })
  })

  describe('Workflow Without Start Node', () => {
    it('should show minimal state with disabled switch', () => {
      mockHookState = createDefaultHookState({
        missingStartNode: true,
        isMinimalState: true,
        toggleDisabled: true,
      })

      render(<MCPServiceCard appInfo={createMockAppInfo(AppModeEnum.WORKFLOW)} />, { wrapper: createWrapper() })

      const switchElement = screen.getByRole('switch')
      expect(switchElement.className).toContain('!cursor-not-allowed')
      expect(switchElement.className).toContain('!opacity-50')
    })
  })

  describe('onChangeStatus edge case', () => {
    it('should clear pending status when handleStatusChange returns activated: false for an enable action', async () => {
      mockHookState = createDefaultHookState({
        serverActivated: false,
        serverPublished: false,
      })
      mockHandleStatusChange.mockResolvedValue({ activated: false })

      render(<MCPServiceCard appInfo={createMockAppInfo()} />, { wrapper: createWrapper() })
      fireEvent.click(screen.getByRole('switch'))

      await waitFor(() => {
        expect(mockHandleStatusChange).toHaveBeenCalledWith(true)
      })

      expect(screen.getByRole('switch')).toBeInTheDocument()
    })
  })

  describe('onServerModalHide', () => {
    it('should call handleServerModalHide with shouldDeactivate: true', async () => {
      mockHookState = createDefaultHookState({
        showMCPServerModal: true,
        serverActivated: false,
      })
      mockHandleServerModalHide.mockReturnValue({ shouldDeactivate: true })

      render(<MCPServiceCard appInfo={createMockAppInfo()} />, { wrapper: createWrapper() })
      fireEvent.click(screen.getByTestId('close-modal-btn'))

      await waitFor(() => {
        expect(mockHandleServerModalHide).toHaveBeenCalled()
      })
    })

    it('should call handleServerModalHide with shouldDeactivate: false', async () => {
      mockHookState = createDefaultHookState({
        showMCPServerModal: true,
        serverActivated: true,
      })
      mockHandleServerModalHide.mockReturnValue({ shouldDeactivate: false })

      render(<MCPServiceCard appInfo={createMockAppInfo()} />, { wrapper: createWrapper() })
      fireEvent.click(screen.getByTestId('close-modal-btn'))

      await waitFor(() => {
        expect(mockHandleServerModalHide).toHaveBeenCalled()
      })
    })
  })

  describe('Accessibility', () => {
    it('should have an accessible switch with button type', () => {
      render(<MCPServiceCard appInfo={createMockAppInfo()} />, { wrapper: createWrapper() })

      const switchElement = screen.getByRole('switch')
      expect(switchElement).toHaveAttribute('type', 'button')
    })
  })
})
