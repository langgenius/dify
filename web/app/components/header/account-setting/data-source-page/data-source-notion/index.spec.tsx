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
 * Interface for the mock query result.
 * Aliases UseQueryResult from TanStack Query.
 */
type MockQueryResult<T> = UseQueryResult<T, Error>

// Mock dependencies to isolate the component under test
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

// Mock the Panel component to verify props and simulate interactions
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

// Mock the NotionIcon used within the logo mapping
vi.mock('@/app/components/base/notion-icon', () => ({
  default: vi.fn(({ src, name, className }: { src: string, name: string, className: string }) => (
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

  // Type-safe App Context mock
  const baseAppContext: AppContextValue = {
    userProfile: {
      id: 'test-user-id',
      name: 'test-user',
      email: 'test@example.com',
      avatar: '',
      avatar_url: '',
      is_password_set: true,
    },
    mutateUserProfile: vi.fn(),
    currentWorkspace: {
      id: 'ws-id',
      name: 'Workspace',
      plan: 'basic',
      status: 'normal',
      created_at: 0,
      role: 'owner',
      providers: [],
      trial_credits: 0,
      trial_credits_used: 0,
      next_credit_reset_date: 0,
    },
    isCurrentWorkspaceManager: true,
    isCurrentWorkspaceOwner: true,
    isCurrentWorkspaceEditor: true,
    isCurrentWorkspaceDatasetOperator: false,
    mutateCurrentWorkspace: vi.fn(),
    langGeniusVersionInfo: {
      current_version: '0.1.0',
      latest_version: '0.1.1',
      version: '0.1.1',
      release_date: '',
      release_notes: '',
      can_auto_update: false,
      current_env: 'test',
    },
    useSelector: vi.fn(),
    isLoadingCurrentWorkspace: false,
    isValidatingCurrentWorkspace: false,
  }

  // Helper to mock successful query results with strict typing
  const mockQuerySuccess = <T,>(data: T): MockQueryResult<T> => ({
    data,
    isSuccess: true,
    isError: false,
    isLoading: false,
    isPending: false,
    status: 'success',
    error: null,
    fetchStatus: 'idle',
  } as unknown as MockQueryResult<T>)

  // Helper to mock pending query results with strict typing
  const mockQueryPending = <T,>(): MockQueryResult<T> => ({
    data: undefined,
    isSuccess: false,
    isError: false,
    isLoading: true,
    isPending: true,
    status: 'pending',
    error: null,
    fetchStatus: 'fetching',
  } as unknown as MockQueryResult<T>)

  const originalLocation = window.location

  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock implementations for common hooks
    vi.mocked(useAppContext).mockReturnValue(baseAppContext)
    vi.mocked(useDataSourceIntegrates).mockReturnValue(mockQuerySuccess({ data: [] }))
    vi.mocked(useNotionConnection).mockReturnValue(mockQueryPending())

    // Mock window.location for redirection tests
    // Use a setter-based approach to avoid read-only restrictions
    const locationMock = {
      href: '',
      assign: vi.fn(),
    }
    Object.defineProperty(window, 'location', {
      value: locationMock,
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    // Restore original window.location
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    })
  })

  /**
   * Test: Renders correctly when no workspaces are configured.
   */
  it('renders with no workspaces initially', () => {
    render(<DataSourceNotion />)
    expect(screen.getByTestId('is-configured')).toHaveTextContent('false')
    expect(screen.getByTestId('configured-list-count')).toHaveTextContent('0')
    expect(useDataSourceIntegrates).toHaveBeenCalledWith({ initialData: undefined })
  })

  /**
   * Test: Renders correctly with workspaces provided as props.
   */
  it('renders with provided workspaces and passes initialData to hook', () => {
    vi.mocked(useDataSourceIntegrates).mockReturnValue(mockQuerySuccess({ data: mockWorkspaces }))
    render(<DataSourceNotion workspaces={mockWorkspaces} />)

    expect(screen.getByTestId('is-configured')).toHaveTextContent('true')
    expect(screen.getByTestId('configured-list-count')).toHaveTextContent('1')
    expect(screen.getByTestId('item-name-ws-1')).toHaveTextContent('Workspace 1')
    expect(screen.getByTestId('item-active-ws-1')).toHaveTextContent('true')
    expect(screen.getByTestId('notion-icon')).toHaveAttribute('src', 'icon-1')
    expect(useDataSourceIntegrates).toHaveBeenCalledWith({ initialData: { data: mockWorkspaces } })
  })

  /**
   * Test: Branch coverage for nullish coalescing on line 43 of index.tsx.
   * Case: integrates is undefined (e.g. while loading)
   */
  it('handles cases where integrates is undefined (loading state)', () => {
    vi.mocked(useDataSourceIntegrates).mockReturnValue(mockQueryPending())
    render(<DataSourceNotion />)
    expect(screen.getByTestId('is-configured')).toHaveTextContent('false')
    expect(screen.getByTestId('configured-list-count')).toHaveTextContent('0')
  })

  /**
   * Test: Branch coverage for nullish coalescing on line 43 of index.tsx.
   * Case: integrates metadata exists but its data property is missing
   */
  it('handles cases where integrates metadata exists but its data property is missing', () => {
    // Use a partial object that matches the expected structure but with missing data
    const brokenData = {} as { data: TDataSourceNotion[] }
    vi.mocked(useDataSourceIntegrates).mockReturnValue(mockQuerySuccess(brokenData))
    render(<DataSourceNotion />)
    expect(screen.getByTestId('is-configured')).toHaveTextContent('false')
    expect(screen.getByTestId('configured-list-count')).toHaveTextContent('0')
  })

  /**
   * Test: Workspace manager can initiate the Notion connection.
   */
  it('handles configure action for workspace manager', () => {
    render(<DataSourceNotion />)
    const configureBtn = screen.getByTestId('configure-btn')
    fireEvent.click(configureBtn)

    expect(useNotionConnection).toHaveBeenCalledWith(true)
  })

  /**
   * Test: Non-manager users are blocked from initiating connection.
   */
  it('does not allow configure action for non-manager', () => {
    vi.mocked(useAppContext).mockReturnValue({ ...baseAppContext, isCurrentWorkspaceManager: false })
    render(<DataSourceNotion />)
    const configureBtn = screen.getByTestId('configure-btn')
    fireEvent.click(configureBtn)

    expect(useNotionConnection).toHaveBeenCalledWith(false)
  })

  /**
   * Test: handleAuthAgain redirects if the auth URL is already available.
   */
  it('handles auth again action when connection data is already available', async () => {
    vi.mocked(useNotionConnection).mockReturnValue(mockQuerySuccess({ data: 'http://auth-url' }))
    render(<DataSourceNotion />)

    const authAgainBtn = screen.getByTestId('auth-again-btn')
    fireEvent.click(authAgainBtn)

    expect(window.location.href).toBe('http://auth-url')
  })

  /**
   * Test: handleAuthAgain triggers connection flow if URL is missing.
   */
  it('handles auth again action when connection data is not available', () => {
    render(<DataSourceNotion />)

    const authAgainBtn = screen.getByTestId('auth-again-btn')
    fireEvent.click(authAgainBtn)

    expect(useNotionConnection).toHaveBeenCalledWith(true)
  })

  /**
   * Test: Automatic redirect via useEffect when hook data updates with a URL.
   */
  it('redirects automatically when connection data returns an http URL', async () => {
    vi.mocked(useNotionConnection).mockReturnValue(mockQuerySuccess({ data: 'http://redirect-url' }))
    render(<DataSourceNotion />)

    await waitFor(() => {
      expect(window.location.href).toBe('http://redirect-url')
    })
  })

  /**
   * Test: Shows toast notification when connection data returns "internal".
   */
  it('shows toast when connection data is "internal"', async () => {
    vi.mocked(useNotionConnection).mockReturnValue(mockQuerySuccess({ data: 'internal' }))
    render(<DataSourceNotion />)

    await waitFor(() => {
      expect(Toast.notify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'info',
        message: 'common.dataSource.notion.integratedAlert',
      }))
    })
  })

  /**
   * Test: Branch coverage for non-matching connection data strings.
   */
  it('does nothing in useEffect when connection data is present but not a redirect or internal', async () => {
    vi.mocked(useNotionConnection).mockReturnValue(mockQuerySuccess({ data: 'unknown' }))
    render(<DataSourceNotion />)

    await waitFor(() => {
      expect(window.location.href).toBe('')
      expect(Toast.notify).not.toHaveBeenCalled()
    })
  })

  /**
   * Test: Branch coverage for data that lacks the expected 'data' property in useEffect.
   */
  it('handles case where data exists but "data" property is missing in useEffect', async () => {
    const brokenData = {} as { data: string }
    vi.mocked(useNotionConnection).mockReturnValue(mockQuerySuccess(brokenData))
    render(<DataSourceNotion />)

    await waitFor(() => {
      expect(window.location.href).toBe('')
    })
  })

  /**
   * Test: Branch coverage for non-string data.data values in useEffect.
   */
  it('handles non-string data.data in useEffect gracefully', async () => {
    const invalidTypeData = { data: 123 } as unknown as { data: string }
    vi.mocked(useNotionConnection).mockReturnValue(mockQuerySuccess(invalidTypeData))
    render(<DataSourceNotion />)

    await waitFor(() => {
      expect(window.location.href).toBe('')
    })
  })

  /**
   * Test: Branch coverage for minimal "http" string in useEffect.
   */
  it('redirects if data starts with http regardless of rest of string', async () => {
    vi.mocked(useNotionConnection).mockReturnValue(mockQuerySuccess({ data: 'http' }))
    render(<DataSourceNotion />)

    await waitFor(() => {
      expect(window.location.href).toBe('http')
    })
  })

  /**
   * Test: Renders correctly with missing fields in workspace metadata.
   */
  it('renders correctly with missing source_info optional fields and defaults total to 0', () => {
    const workspaceWithMissingInfo: TDataSourceNotion = {
      id: 'ws-2',
      provider: 'notion',
      is_bound: false,
      source_info: {
        workspace_name: 'Workspace 2',
        workspace_id: 'notion-ws-2',
        workspace_icon: null,
        pages: [],
      },
    }

    vi.mocked(useDataSourceIntegrates).mockReturnValue(mockQuerySuccess({ data: [workspaceWithMissingInfo] }))
    render(<DataSourceNotion />)

    expect(screen.getByTestId('item-name-ws-2')).toHaveTextContent('Workspace 2')

    const panelCall = vi.mocked(Panel).mock.calls.find(call =>
      call[0].configuredList.some(item => (item as ConfigItemType).id === 'ws-2'),
    )
    expect(panelCall?.[0].configuredList[0].notionConfig?.total).toBe(0)
  })

  /**
   * Test: Correctly identifies when a workspace is NOT active.
   */
  it('displays inactive status correctly for unbound workspaces', () => {
    const inactiveWS: TDataSourceNotion = {
      id: 'ws-3',
      provider: 'notion',
      is_bound: false,
      source_info: {
        workspace_name: 'Workspace 3',
        workspace_icon: 'icon-3',
        workspace_id: 'notion-ws-3',
        total: 5,
        pages: [],
      },
    }
    vi.mocked(useDataSourceIntegrates).mockReturnValue(mockQuerySuccess({ data: [inactiveWS] }))
    render(<DataSourceNotion />)

    expect(screen.getByTestId('item-active-ws-3')).toHaveTextContent('false')
  })

  /**
   * Test: readOnly prop is true when user is not manager.
   */
  it('passes readOnly as true when user is NOT a manager', () => {
    vi.mocked(useAppContext).mockReturnValue({ ...baseAppContext, isCurrentWorkspaceManager: false })
    render(<DataSourceNotion />)
    expect(screen.getByTestId('read-only')).toHaveTextContent('true')
  })

  /**
   * Test: readOnly prop is false when user is manager.
   */
  it('passes readOnly as false when user IS a manager', () => {
    vi.mocked(useAppContext).mockReturnValue({ ...baseAppContext, isCurrentWorkspaceManager: true })
    render(<DataSourceNotion />)
    expect(screen.getByTestId('read-only')).toHaveTextContent('false')
  })
})
