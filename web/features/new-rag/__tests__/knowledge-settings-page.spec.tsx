import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/console/render'
import { KnowledgeSettingsPage } from '../knowledge-settings-page'

const useQueryOptionsMock = vi.hoisted(() => vi.fn())
const navigationMock = vi.hoisted(() => ({
  replace: vi.fn(),
  searchParams: new URLSearchParams(),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ replace: navigationMock.replace }),
  useSearchParams: () => navigationMock.searchParams,
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useQuery: (options: Parameters<typeof actual.useQuery>[0]) => {
      useQueryOptionsMock(options)
      return actual.useQuery(options)
    },
  }
})

const membersQueryMock = vi.hoisted(() => ({
  data: undefined as { accounts: [] } | undefined,
  isError: false,
  isPending: true,
  refetch: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/service/use-common', () => ({
  useMembers: () => membersQueryMock,
}))

vi.mock('../knowledge-settings-form', () => ({
  KnowledgeSettingsForm: ({
    onDraftFinish,
    onDraftStart,
    serverConflict,
  }: {
    onDraftFinish: () => void
    onDraftStart: () => void
    serverConflict: boolean
  }) => (
    <div>
      settings-form
      <span>{serverConflict ? 'server-conflict' : 'no-conflict'}</span>
      <button type="button" onClick={onDraftStart}>
        start-draft
      </button>
      <button type="button" onClick={onDraftFinish}>
        finish-draft
      </button>
    </div>
  ),
}))

const queryData = vi.hoisted(() => ({
  settings: {
    active_profile_available: true,
    active_profile_revisions: { embedding: 1, retrieval: 1 },
    capabilities: {
      deep: true,
      index: true,
      ingest: true,
      query: true,
      research: true,
      source_sync: true,
    },
    configuration_state: 'active',
    embedding: null,
    issues: [],
    retrieval: null,
    revision: 1,
  },
  space: {
    control_space_id: 'space-1',
    created_at: '2026-07-28T00:00:00Z',
    knowledge_space_id: 'knowledge-1',
    owner_account_id: 'owner-1',
    permission_keys: ['knowledge_space_access_config', 'knowledge_space_edit'],
    resource_version: 1,
    state: 'active',
    technical_status: 'available',
    technical_summary: null,
    updated_at: '2026-07-28T00:00:00Z',
    visibility: 'only_me',
  },
}))

vi.mock('@/service/client', () => {
  const query = (key: string, data: unknown) => ({
    key: () => ['knowledge-fs', key],
    queryOptions: () => ({
      queryFn: () => Promise.resolve(data),
      queryKey: ['knowledge-fs', key],
    }),
  })
  return {
    consoleQuery: {
      knowledgeFs: {
        spaces: {
          byControlSpaceId: {
            externalAccess: {
              get: query('external-access', {
                agent_enabled: false,
                mcp_enabled: false,
                revision: 1,
                service_api_enabled: false,
                workflow_enabled: false,
              }),
            },
            get: query('space', queryData.space),
            permissions: { get: query('permissions', { data: [] }) },
            settings: { get: query('settings', queryData.settings) },
          },
        },
      },
    },
  }
})

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return {
    queryClient,
    ...render(<KnowledgeSettingsPage knowledgeSpaceId="space-1" />, { wrapper: Wrapper }),
  }
}

describe('KnowledgeSettingsPage', () => {
  beforeEach(() => {
    membersQueryMock.data = undefined
    membersQueryMock.isError = false
    membersQueryMock.isPending = true
    membersQueryMock.refetch.mockClear()
    useQueryOptionsMock.mockClear()
    navigationMock.replace.mockClear()
    navigationMock.searchParams = new URLSearchParams()
    queryData.settings.capabilities.ingest = true
  })

  it('keeps the settings form gated while workspace members are loading', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.queryByText('settings-form')).not.toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent('common.loading')
      expect(screen.getByRole('status')).not.toHaveTextContent(
        'dataset.newKnowledge.settings.basicInfo',
      )
      expect(screen.getByRole('status')).not.toHaveTextContent(
        'dataset.newKnowledge.settings.dangerZone',
      )
      expect(screen.getByText('dataset.newKnowledge.settings.basicInfo')).toBeInTheDocument()
      expect(screen.getByText('dataset.newKnowledge.settings.dangerZone')).toBeInTheDocument()
    })
  })

  it('shows the page error state and retries the members request', async () => {
    const user = userEvent.setup()
    membersQueryMock.isPending = false
    membersQueryMock.isError = true
    renderPage()

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    expect(membersQueryMock.refetch).toHaveBeenCalledOnce()
    expect(screen.queryByText('settings-form')).not.toBeInTheDocument()
  })

  it('polls settings while model validation is pending', async () => {
    membersQueryMock.data = { accounts: [] }
    membersQueryMock.isPending = false
    renderPage()

    expect(await screen.findByText('settings-form')).toBeInTheDocument()

    const settingsOptions = useQueryOptionsMock.mock.calls
      .map(([options]) => options)
      .find((options) => options.queryKey?.[1] === 'settings') as {
      refetchInterval: (query: {
        state: { data?: { configuration_state?: 'active' | 'pending-validation' } }
      }) => false | number
    }

    expect(
      settingsOptions.refetchInterval({
        state: { data: { configuration_state: 'pending-validation' } },
      }),
    ).toBe(2000)
    expect(
      settingsOptions.refetchInterval({
        state: { data: { configuration_state: 'active' } },
      }),
    ).toBe(false)
  })

  it('keeps an active draft mounted and reports a conflict when the server version changes', async () => {
    const user = userEvent.setup()
    membersQueryMock.data = { accounts: [] }
    membersQueryMock.isPending = false
    const { queryClient } = renderPage()

    expect(await screen.findByText('no-conflict')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'start-draft' }))
    act(() => {
      queryClient.setQueryData(['knowledge-fs', 'space'], {
        ...queryData.space,
        resource_version: 2,
      })
    })

    expect(await screen.findByText('server-conflict')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'finish-draft' }))
    expect(await screen.findByText('no-conflict')).toBeInTheDocument()
  })

  it('does not report a basic info conflict when immediate retrieval settings refresh', async () => {
    const user = userEvent.setup()
    membersQueryMock.data = { accounts: [] }
    membersQueryMock.isPending = false
    const { queryClient } = renderPage()

    expect(await screen.findByText('no-conflict')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'start-draft' }))
    act(() => {
      queryClient.setQueryData(['knowledge-fs', 'settings'], {
        ...queryData.settings,
        revision: 2,
      })
    })

    expect(await screen.findByText('no-conflict')).toBeInTheDocument()
  })

  it('returns to a validated source page when its blocked capability becomes available', async () => {
    membersQueryMock.data = { accounts: [] }
    membersQueryMock.isPending = false
    navigationMock.searchParams = new URLSearchParams({
      capability: 'ingest',
      returnTo: '/datasets/new/space-1/documents',
    })
    queryData.settings.capabilities.ingest = false
    const { queryClient } = renderPage()
    expect(await screen.findByText('settings-form')).toBeInTheDocument()
    expect(navigationMock.replace).not.toHaveBeenCalled()

    act(() => {
      queryClient.setQueryData(['knowledge-fs', 'settings'], {
        ...queryData.settings,
        capabilities: { ...queryData.settings.capabilities, ingest: true },
      })
    })
    await waitFor(() =>
      expect(navigationMock.replace).toHaveBeenCalledWith('/datasets/new/space-1/documents'),
    )
  })
})
