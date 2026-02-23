import type { UseQueryResult } from '@tanstack/react-query'
import type { AppContextValue } from '@/context/app-context'
import type { DataSourceNotion as TDataSourceNotion } from '@/models/common'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useAppContext } from '@/context/app-context'
import { useDataSourceIntegrates, useInvalidDataSourceIntegrates, useNotionConnection } from '@/service/use-common'
import DataSourceNotion from './index'

/**
 * DataSourceNotion Component Tests
 * Using Unit approach with real Panel and sibling components to test Notion integration logic.
 */

type MockQueryResult<T> = UseQueryResult<T, Error>

// Mock dependencies
vi.mock('@/context/app-context', () => ({
  useAppContext: vi.fn(),
}))

vi.mock('@/service/common', () => ({
  syncDataSourceNotion: vi.fn(),
  updateDataSourceNotionAction: vi.fn(),
}))

vi.mock('@/service/use-common', () => ({
  useDataSourceIntegrates: vi.fn(),
  useNotionConnection: vi.fn(),
  useInvalidDataSourceIntegrates: vi.fn(),
}))

describe('DataSourceNotion Component', () => {
  const mockWorkspaces: TDataSourceNotion[] = [
    {
      id: 'ws-1',
      provider: 'notion',
      is_bound: true,
      source_info: {
        workspace_name: 'Workspace 1',
        workspace_icon: 'https://example.com/icon-1.png',
        workspace_id: 'notion-ws-1',
        total: 10,
        pages: [],
      },
    },
  ]

  const baseAppContext: AppContextValue = {
    userProfile: { id: 'test-user-id', name: 'test-user', email: 'test@example.com', avatar: '', avatar_url: '', is_password_set: true },
    mutateUserProfile: vi.fn(),
    currentWorkspace: { id: 'ws-id', name: 'Workspace', plan: 'basic', status: 'normal', created_at: 0, role: 'owner', providers: [], trial_credits: 0, trial_credits_used: 0, next_credit_reset_date: 0 },
    isCurrentWorkspaceManager: true,
    isCurrentWorkspaceOwner: true,
    isCurrentWorkspaceEditor: true,
    isCurrentWorkspaceDatasetOperator: false,
    mutateCurrentWorkspace: vi.fn(),
    langGeniusVersionInfo: { current_version: '0.1.0', latest_version: '0.1.1', version: '0.1.1', release_date: '', release_notes: '', can_auto_update: false, current_env: 'test' },
    useSelector: vi.fn(),
    isLoadingCurrentWorkspace: false,
    isValidatingCurrentWorkspace: false,
  }

  /* eslint-disable-next-line ts/no-explicit-any */
  const mockQuerySuccess = <T,>(data: T): MockQueryResult<T> => ({ data, isSuccess: true, isError: false, isLoading: false, isPending: false, status: 'success', error: null, fetchStatus: 'idle' } as any)
  /* eslint-disable-next-line ts/no-explicit-any */
  const mockQueryPending = <T,>(): MockQueryResult<T> => ({ data: undefined, isSuccess: false, isError: false, isLoading: true, isPending: true, status: 'pending', error: null, fetchStatus: 'fetching' } as any)

  const originalLocation = window.location

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useAppContext).mockReturnValue(baseAppContext)
    vi.mocked(useDataSourceIntegrates).mockReturnValue(mockQuerySuccess({ data: [] }))
    vi.mocked(useNotionConnection).mockReturnValue(mockQueryPending())
    vi.mocked(useInvalidDataSourceIntegrates).mockReturnValue(vi.fn())

    const locationMock = { href: '', assign: vi.fn() }
    Object.defineProperty(window, 'location', { value: locationMock, writable: true, configurable: true })

    // Clear document body to avoid toast leaks between tests
    document.body.innerHTML = ''
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', { value: originalLocation, writable: true, configurable: true })
  })

  const getWorkspaceItem = (name: string) => {
    const nameEl = screen.getByText(name)
    return (nameEl.closest('div[class*="workspace-item"]') || nameEl.parentElement) as HTMLElement
  }

  describe('Rendering', () => {
    it('should render with no workspaces initially and call integration hook', () => {
      // Act
      render(<DataSourceNotion />)

      // Assert
      expect(screen.getByText('common.dataSource.notion.title')).toBeInTheDocument()
      expect(screen.queryByText('common.dataSource.notion.connectedWorkspace')).not.toBeInTheDocument()
      expect(useDataSourceIntegrates).toHaveBeenCalledWith({ initialData: undefined })
    })

    it('should render with provided workspaces and pass initialData to hook', () => {
      // Arrange
      vi.mocked(useDataSourceIntegrates).mockReturnValue(mockQuerySuccess({ data: mockWorkspaces }))

      // Act
      render(<DataSourceNotion workspaces={mockWorkspaces} />)

      // Assert
      expect(screen.getByText('common.dataSource.notion.connectedWorkspace')).toBeInTheDocument()
      expect(screen.getByText('Workspace 1')).toBeInTheDocument()
      expect(screen.getByText('common.dataSource.notion.connected')).toBeInTheDocument()
      expect(screen.getByAltText('workspace icon')).toHaveAttribute('src', 'https://example.com/icon-1.png')
      expect(useDataSourceIntegrates).toHaveBeenCalledWith({ initialData: { data: mockWorkspaces } })
    })

    it('should handle workspaces prop being an empty array', () => {
      // Act
      render(<DataSourceNotion workspaces={[]} />)

      // Assert
      expect(screen.queryByText('common.dataSource.notion.connectedWorkspace')).not.toBeInTheDocument()
      expect(useDataSourceIntegrates).toHaveBeenCalledWith({ initialData: { data: [] } })
    })

    it('should handle optional workspaces configurations', () => {
      // Branch: workspaces passed as undefined
      const { rerender } = render(<DataSourceNotion workspaces={undefined} />)
      expect(useDataSourceIntegrates).toHaveBeenCalledWith({ initialData: undefined })

      // Branch: workspaces passed as null
      /* eslint-disable-next-line ts/no-explicit-any */
      rerender(<DataSourceNotion workspaces={null as any} />)
      expect(useDataSourceIntegrates).toHaveBeenCalledWith({ initialData: undefined })

      // Branch: workspaces passed as []
      rerender(<DataSourceNotion workspaces={[]} />)
      expect(useDataSourceIntegrates).toHaveBeenCalledWith({ initialData: { data: [] } })
    })

    it('should handle cases where integrates data is loading or broken', () => {
      // Act (Loading)
      const { rerender } = render(<DataSourceNotion />)
      vi.mocked(useDataSourceIntegrates).mockReturnValue(mockQueryPending())
      rerender(<DataSourceNotion />)
      // Assert
      expect(screen.queryByText('common.dataSource.notion.connectedWorkspace')).not.toBeInTheDocument()

      // Act (Broken)
      const brokenData = {} as { data: TDataSourceNotion[] }
      vi.mocked(useDataSourceIntegrates).mockReturnValue(mockQuerySuccess(brokenData))
      rerender(<DataSourceNotion />)
      // Assert
      expect(screen.queryByText('common.dataSource.notion.connectedWorkspace')).not.toBeInTheDocument()
    })

    it('should handle integrates being nullish', () => {
      /* eslint-disable-next-line ts/no-explicit-any */
      vi.mocked(useDataSourceIntegrates).mockReturnValue({ data: undefined, isSuccess: true } as any)
      render(<DataSourceNotion />)
      expect(screen.queryByText('common.dataSource.notion.connectedWorkspace')).not.toBeInTheDocument()
    })

    it('should handle integrates data being nullish', () => {
      /* eslint-disable-next-line ts/no-explicit-any */
      vi.mocked(useDataSourceIntegrates).mockReturnValue({ data: { data: null }, isSuccess: true } as any)
      render(<DataSourceNotion />)
      expect(screen.queryByText('common.dataSource.notion.connectedWorkspace')).not.toBeInTheDocument()
    })

    it('should handle integrates data being valid', () => {
      /* eslint-disable-next-line ts/no-explicit-any */
      vi.mocked(useDataSourceIntegrates).mockReturnValue({ data: { data: [{ id: '1', is_bound: true, source_info: { workspace_name: 'W', workspace_icon: 'https://example.com/i.png', total: 1, pages: [] } }] }, isSuccess: true } as any)
      render(<DataSourceNotion />)
      expect(screen.getByText('common.dataSource.notion.connectedWorkspace')).toBeInTheDocument()
    })

    it('should cover all possible falsy/nullish branches for integrates and workspaces', () => {
      /* eslint-disable-next-line ts/no-explicit-any */
      const { rerender } = render(<DataSourceNotion workspaces={null as any} />)

      const integratesCases = [
        undefined,
        null,
        {},
        { data: null },
        { data: undefined },
        { data: [] },
        { data: [mockWorkspaces[0]] },
        { data: false },
        { data: 0 },
        { data: '' },
        123,
        'string',
        false,
      ]

      integratesCases.forEach((val) => {
        /* eslint-disable-next-line ts/no-explicit-any */
        vi.mocked(useDataSourceIntegrates).mockReturnValue({ data: val, isSuccess: true } as any)
        /* eslint-disable-next-line ts/no-explicit-any */
        rerender(<DataSourceNotion workspaces={null as any} />)
      })

      expect(useDataSourceIntegrates).toHaveBeenCalled()
    })
  })

  describe('User Permissions', () => {
    it('should pass readOnly as false when user is a manager', () => {
      // Arrange
      vi.mocked(useAppContext).mockReturnValue({ ...baseAppContext, isCurrentWorkspaceManager: true })

      // Act
      render(<DataSourceNotion />)

      // Assert
      expect(screen.getByText('common.dataSource.notion.title').closest('div')).not.toHaveClass('grayscale')
    })

    it('should pass readOnly as true when user is NOT a manager', () => {
      // Arrange
      vi.mocked(useAppContext).mockReturnValue({ ...baseAppContext, isCurrentWorkspaceManager: false })

      // Act
      render(<DataSourceNotion />)

      // Assert
      expect(screen.getByText('common.dataSource.connect')).toHaveClass('opacity-50', 'grayscale')
    })
  })

  describe('Configure and Auth Actions', () => {
    it('should handle configure action when user is workspace manager', () => {
      // Arrange
      render(<DataSourceNotion />)

      // Act
      fireEvent.click(screen.getByText('common.dataSource.connect'))

      // Assert
      expect(useNotionConnection).toHaveBeenCalledWith(true)
    })

    it('should block configure action when user is NOT workspace manager', () => {
      // Arrange
      vi.mocked(useAppContext).mockReturnValue({ ...baseAppContext, isCurrentWorkspaceManager: false })
      render(<DataSourceNotion />)

      // Act
      fireEvent.click(screen.getByText('common.dataSource.connect'))

      // Assert
      expect(useNotionConnection).toHaveBeenCalledWith(false)
    })

    it('should redirect if auth URL is available when "Auth Again" is clicked', async () => {
      // Arrange
      vi.mocked(useDataSourceIntegrates).mockReturnValue(mockQuerySuccess({ data: mockWorkspaces }))
      vi.mocked(useNotionConnection).mockReturnValue(mockQuerySuccess({ data: 'http://auth-url' }))
      render(<DataSourceNotion />)

      // Act
      const workspaceItem = getWorkspaceItem('Workspace 1')
      const actionBtn = within(workspaceItem).getByRole('button')
      fireEvent.click(actionBtn)
      const authAgainBtn = await screen.findByText('common.dataSource.notion.changeAuthorizedPages')
      fireEvent.click(authAgainBtn)

      // Assert
      expect(window.location.href).toBe('http://auth-url')
    })

    it('should trigger connection flow if URL is missing when "Auth Again" is clicked', async () => {
      // Arrange
      vi.mocked(useDataSourceIntegrates).mockReturnValue(mockQuerySuccess({ data: mockWorkspaces }))
      render(<DataSourceNotion />)

      // Act
      const workspaceItem = getWorkspaceItem('Workspace 1')
      const actionBtn = within(workspaceItem).getByRole('button')
      fireEvent.click(actionBtn)
      const authAgainBtn = await screen.findByText('common.dataSource.notion.changeAuthorizedPages')
      fireEvent.click(authAgainBtn)

      // Assert
      expect(useNotionConnection).toHaveBeenCalledWith(true)
    })
  })

  describe('Side Effects (Redirection and Toast)', () => {
    it('should redirect automatically when connection data returns an http URL', async () => {
      // Arrange
      vi.mocked(useNotionConnection).mockReturnValue(mockQuerySuccess({ data: 'http://redirect-url' }))

      // Act
      render(<DataSourceNotion />)

      // Assert
      await waitFor(() => {
        expect(window.location.href).toBe('http://redirect-url')
      })
    })

    it('should show toast notification when connection data is "internal"', async () => {
      // Arrange
      vi.mocked(useNotionConnection).mockReturnValue(mockQuerySuccess({ data: 'internal' }))

      // Act
      render(<DataSourceNotion />)

      // Assert
      expect(await screen.findByText('common.dataSource.notion.integratedAlert')).toBeInTheDocument()
    })

    it('should handle various data types and missing properties in connection data correctly', async () => {
      // Arrange & Act (Unknown string)
      const { rerender } = render(<DataSourceNotion />)
      vi.mocked(useNotionConnection).mockReturnValue(mockQuerySuccess({ data: 'unknown' }))
      rerender(<DataSourceNotion />)
      // Assert
      await waitFor(() => {
        expect(window.location.href).toBe('')
        expect(screen.queryByText('common.dataSource.notion.integratedAlert')).not.toBeInTheDocument()
      })

      // Act (Broken object)
      /* eslint-disable-next-line ts/no-explicit-any */
      vi.mocked(useNotionConnection).mockReturnValue(mockQuerySuccess({} as any))
      rerender(<DataSourceNotion />)
      // Assert
      await waitFor(() => {
        expect(window.location.href).toBe('')
      })

      // Act (Non-string)
      /* eslint-disable-next-line ts/no-explicit-any */
      vi.mocked(useNotionConnection).mockReturnValue(mockQuerySuccess({ data: 123 } as any))
      rerender(<DataSourceNotion />)
      // Assert
      await waitFor(() => {
        expect(window.location.href).toBe('')
      })
    })

    it('should redirect if data starts with "http" even if it is just "http"', async () => {
      // Arrange
      vi.mocked(useNotionConnection).mockReturnValue(mockQuerySuccess({ data: 'http' }))

      // Act
      render(<DataSourceNotion />)

      // Assert
      await waitFor(() => {
        expect(window.location.href).toBe('http')
      })
    })

    it('should skip side effect logic if connection data is an object but missing the "data" property', async () => {
      // Arrange
      /* eslint-disable-next-line ts/no-explicit-any */
      vi.mocked(useNotionConnection).mockReturnValue({} as any)

      // Act
      render(<DataSourceNotion />)

      // Assert
      await waitFor(() => {
        expect(window.location.href).toBe('')
      })
    })

    it('should skip side effect logic if data.data is falsy', async () => {
      // Arrange
      /* eslint-disable-next-line ts/no-explicit-any */
      vi.mocked(useNotionConnection).mockReturnValue({ data: { data: null } } as any)

      // Act
      render(<DataSourceNotion />)

      // Assert
      await waitFor(() => {
        expect(window.location.href).toBe('')
      })
    })
  })

  describe('Additional Action Edge Cases', () => {
    it('should cover all possible falsy/nullish branches for connection data in handleAuthAgain and useEffect', async () => {
      vi.mocked(useDataSourceIntegrates).mockReturnValue(mockQuerySuccess({ data: mockWorkspaces }))
      render(<DataSourceNotion />)

      const connectionCases = [
        undefined,
        null,
        {},
        { data: undefined },
        { data: null },
        { data: '' },
        { data: 0 },
        { data: false },
        { data: 'http' },
        { data: 'internal' },
        { data: 'unknown' },
      ]

      for (const val of connectionCases) {
        /* eslint-disable-next-line ts/no-explicit-any */
        vi.mocked(useNotionConnection).mockReturnValue({ data: val, isSuccess: true } as any)

        // Trigger handleAuthAgain with these values
        const workspaceItem = getWorkspaceItem('Workspace 1')
        const actionBtn = within(workspaceItem).getByRole('button')
        fireEvent.click(actionBtn)
        const authAgainBtn = await screen.findByText('common.dataSource.notion.changeAuthorizedPages')
        fireEvent.click(authAgainBtn)
      }

      await waitFor(() => expect(useNotionConnection).toHaveBeenCalled())
    })
  })

  describe('Edge Cases in Workspace Data', () => {
    it('should render correctly with missing source_info optional fields', async () => {
      // Arrange
      const workspaceWithMissingInfo: TDataSourceNotion = {
        id: 'ws-2',
        provider: 'notion',
        is_bound: false,
        source_info: { workspace_name: 'Workspace 2', workspace_id: 'notion-ws-2', workspace_icon: null, pages: [] },
      }
      vi.mocked(useDataSourceIntegrates).mockReturnValue(mockQuerySuccess({ data: [workspaceWithMissingInfo] }))

      // Act
      render(<DataSourceNotion />)

      // Assert
      expect(screen.getByText('Workspace 2')).toBeInTheDocument()

      const workspaceItem = getWorkspaceItem('Workspace 2')
      const actionBtn = within(workspaceItem).getByRole('button')
      fireEvent.click(actionBtn)

      expect(await screen.findByText('0 common.dataSource.notion.pagesAuthorized')).toBeInTheDocument()
    })

    it('should display inactive status correctly for unbound workspaces', () => {
      // Arrange
      const inactiveWS: TDataSourceNotion = {
        id: 'ws-3',
        provider: 'notion',
        is_bound: false,
        source_info: { workspace_name: 'Workspace 3', workspace_icon: 'https://example.com/icon-3.png', workspace_id: 'notion-ws-3', total: 5, pages: [] },
      }
      vi.mocked(useDataSourceIntegrates).mockReturnValue(mockQuerySuccess({ data: [inactiveWS] }))

      // Act
      render(<DataSourceNotion />)

      // Assert
      expect(screen.getByText('common.dataSource.notion.disconnected')).toBeInTheDocument()
    })
  })
})
