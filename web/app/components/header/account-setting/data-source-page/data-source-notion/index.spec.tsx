import type { UseQueryResult } from '@tanstack/react-query'
import type { ConfigItemType } from '../panel/config-item'
import type { AppContextValue } from '@/context/app-context'
import type { DataSourceNotion as TDataSourceNotion } from '@/models/common'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Toast from '@/app/components/base/toast'
import { useAppContext } from '@/context/app-context'
import { useDataSourceIntegrates, useNotionConnection } from '@/service/use-common'
import Panel from '../panel'
import DataSourceNotion from './index'

/**
 * DataSourceNotion Component Tests
 * Using Unit approach with mocked Panel to isolate Notion integration logic.
 */

type MockQueryResult<T> = UseQueryResult<T, Error>

// Mock dependencies
vi.mock('@/context/app-context', () => ({
  useAppContext: vi.fn(),
}))

vi.mock('@/service/use-common', () => ({
  useDataSourceIntegrates: vi.fn(),
  useNotionConnection: vi.fn(),
}))

vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: vi.fn(),
  },
}))

vi.mock('../panel', () => ({
  default: vi.fn(({ onConfigure, notionActions, configuredList, isConfigured, readOnly }: {
    onConfigure: () => void
    notionActions: { onChangeAuthorizedPage: () => void }
    configuredList: ConfigItemType[]
    isConfigured: boolean
    readOnly: boolean
  }) => (
    <div data-testid="panel-mock">
      <div data-testid="is-configured">{isConfigured.toString()}</div>
      <div data-testid="read-only">{readOnly.toString()}</div>
      <button data-testid="configure-btn" onClick={onConfigure}>Configure</button>
      <button data-testid="auth-again-btn" onClick={notionActions.onChangeAuthorizedPage}>Auth Again</button>
      <div data-testid="configured-list-count">{configuredList.length}</div>
      {configuredList.map(item => (
        <div key={item.id} data-testid={`item-${item.id}`}>
          <span data-testid={`item-name-${item.id}`}>{item.name}</span>
          <span data-testid={`item-active-${item.id}`}>{item.isActive.toString()}</span>
          <div data-testid={`item-logo-${item.id}`}>
            {item.logo({ className: 'test-class' })}
          </div>
        </div>
      ))}
    </div>
  )),
}))

vi.mock('@/app/components/base/notion-icon', () => ({
  default: vi.fn(({ src, name, className }: { src: string, name: string, className: string }) => (
    /* eslint-disable-next-line next/no-img-element */
    <img data-testid="notion-icon" src={src} alt={name} className={className} />
  )),
}))

describe('DataSourceNotion Component', () => {
  const mockWorkspaces: TDataSourceNotion[] = [
    {
      id: 'ws-1',
      provider: 'notion',
      is_bound: true,
      source_info: {
        workspace_name: 'Workspace 1',
        workspace_icon: 'icon-1',
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

    const locationMock = { href: '', assign: vi.fn() }
    Object.defineProperty(window, 'location', { value: locationMock, writable: true, configurable: true })
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', { value: originalLocation, writable: true, configurable: true })
  })

  describe('Rendering', () => {
    it('should render with no workspaces initially and call integration hook', () => {
      // Act
      render(<DataSourceNotion />)

      // Assert
      expect(screen.getByTestId('is-configured')).toHaveTextContent('false')
      expect(screen.getByTestId('configured-list-count')).toHaveTextContent('0')
      expect(useDataSourceIntegrates).toHaveBeenCalledWith({ initialData: undefined })
    })

    it('should render with provided workspaces and pass initialData to hook', () => {
      // Arrange
      vi.mocked(useDataSourceIntegrates).mockReturnValue(mockQuerySuccess({ data: mockWorkspaces }))

      // Act
      render(<DataSourceNotion workspaces={mockWorkspaces} />)

      // Assert
      expect(screen.getByTestId('is-configured')).toHaveTextContent('true')
      expect(screen.getByTestId('configured-list-count')).toHaveTextContent('1')
      expect(screen.getByTestId('item-name-ws-1')).toHaveTextContent('Workspace 1')
      expect(screen.getByTestId('item-active-ws-1')).toHaveTextContent('true')
      expect(screen.getByTestId('notion-icon')).toHaveAttribute('src', 'icon-1')
      expect(useDataSourceIntegrates).toHaveBeenCalledWith({ initialData: { data: mockWorkspaces } })
    })

    it('should handle workspaces prop being an empty array', () => {
      // Act
      render(<DataSourceNotion workspaces={[]} />)

      // Assert
      expect(screen.getByTestId('is-configured')).toHaveTextContent('false')
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
      expect(screen.getByTestId('is-configured')).toHaveTextContent('false')

      // Act (Broken)
      const brokenData = {} as { data: TDataSourceNotion[] }
      vi.mocked(useDataSourceIntegrates).mockReturnValue(mockQuerySuccess(brokenData))
      rerender(<DataSourceNotion />)
      // Assert
      expect(screen.getByTestId('configured-list-count')).toHaveTextContent('0')
    })

    it('Branch 43.1: integrates is nullish', () => {
      /* eslint-disable-next-line ts/no-explicit-any */
      vi.mocked(useDataSourceIntegrates).mockReturnValue({ data: undefined, isSuccess: true } as any)
      render(<DataSourceNotion />)
      expect(screen.getByTestId('is-configured')).toHaveTextContent('false')
    })

    it('Branch 43.2: integrates is truthy, data is nullish', () => {
      /* eslint-disable-next-line ts/no-explicit-any */
      vi.mocked(useDataSourceIntegrates).mockReturnValue({ data: { data: null }, isSuccess: true } as any)
      render(<DataSourceNotion />)
      expect(screen.getByTestId('is-configured')).toHaveTextContent('false')
    })

    it('Branch 43.3: integrates is truthy, data is truthy', () => {
      /* eslint-disable-next-line ts/no-explicit-any */
      vi.mocked(useDataSourceIntegrates).mockReturnValue({ data: { data: [{ id: '1', is_bound: true, source_info: { workspace_name: 'W', workspace_icon: 'i', total: 1, pages: [] } }] }, isSuccess: true } as any)
      render(<DataSourceNotion />)
      expect(screen.getByTestId('is-configured')).toHaveTextContent('true')
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
      expect(screen.getByTestId('read-only')).toHaveTextContent('false')
    })

    it('should pass readOnly as true when user is NOT a manager', () => {
      // Arrange
      vi.mocked(useAppContext).mockReturnValue({ ...baseAppContext, isCurrentWorkspaceManager: false })

      // Act
      render(<DataSourceNotion />)

      // Assert
      expect(screen.getByTestId('read-only')).toHaveTextContent('true')
    })
  })

  describe('Configure and Auth Actions', () => {
    it('should handle configure action when user is workspace manager', () => {
      // Arrange
      render(<DataSourceNotion />)

      // Act
      fireEvent.click(screen.getByTestId('configure-btn'))

      // Assert
      expect(useNotionConnection).toHaveBeenCalledWith(true)
    })

    it('should block configure action when user is NOT workspace manager', () => {
      // Arrange
      vi.mocked(useAppContext).mockReturnValue({ ...baseAppContext, isCurrentWorkspaceManager: false })
      render(<DataSourceNotion />)

      // Act
      fireEvent.click(screen.getByTestId('configure-btn'))

      // Assert
      expect(useNotionConnection).toHaveBeenCalledWith(false)
    })

    it('should redirect if auth URL is available when "Auth Again" is clicked', async () => {
      // Arrange
      vi.mocked(useNotionConnection).mockReturnValue(mockQuerySuccess({ data: 'http://auth-url' }))
      render(<DataSourceNotion />)

      // Act
      fireEvent.click(screen.getByTestId('auth-again-btn'))

      // Assert
      expect(window.location.href).toBe('http://auth-url')
    })

    it('should trigger connection flow if URL is missing when "Auth Again" is clicked', () => {
      // Arrange
      render(<DataSourceNotion />)

      // Act
      fireEvent.click(screen.getByTestId('auth-again-btn'))

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
      await waitFor(() => {
        expect(Toast.notify).toHaveBeenCalledWith(expect.objectContaining({
          type: 'info',
          message: 'common.dataSource.notion.integratedAlert',
        }))
      })
    })

    it('should handle various data types and missing properties in connection data correctly', async () => {
      // Arrange & Act (Unknown string)
      const { rerender } = render(<DataSourceNotion />)
      vi.mocked(useNotionConnection).mockReturnValue(mockQuerySuccess({ data: 'unknown' }))
      rerender(<DataSourceNotion />)
      // Assert
      await waitFor(() => {
        expect(window.location.href).toBe('')
        expect(Toast.notify).not.toHaveBeenCalled()
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
      const { rerender } = render(<DataSourceNotion />)

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
        rerender(<DataSourceNotion />)

        // Trigger handleAuthAgain with these values
        fireEvent.click(screen.getByTestId('auth-again-btn'))
      }

      await waitFor(() => expect(useNotionConnection).toHaveBeenCalled())
    })
  })

  describe('Edge Cases in Workspace Data', () => {
    it('should render correctly with missing source_info optional fields', () => {
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
      expect(screen.getByTestId('item-name-ws-2')).toHaveTextContent('Workspace 2')
      const panelCall = vi.mocked(Panel).mock.calls.find(call => call[0].configuredList.some(item => item.id === 'ws-2'))
      expect(panelCall?.[0].configuredList[0].notionConfig?.total).toBe(0)
    })

    it('should display inactive status correctly for unbound workspaces', () => {
      // Arrange
      const inactiveWS: TDataSourceNotion = {
        id: 'ws-3',
        provider: 'notion',
        is_bound: false,
        source_info: { workspace_name: 'Workspace 3', workspace_icon: 'icon-3', workspace_id: 'notion-ws-3', total: 5, pages: [] },
      }
      vi.mocked(useDataSourceIntegrates).mockReturnValue(mockQuerySuccess({ data: [inactiveWS] }))

      // Act
      render(<DataSourceNotion />)

      // Assert
      expect(screen.getByTestId('item-active-ws-3')).toHaveTextContent('false')
    })
  })
})
