import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/console/render'
import { KnowledgeSettingsPage } from '../knowledge-settings-page'

const useQueryOptionsMock = vi.hoisted(() => vi.fn())

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
  KnowledgeSettingsForm: () => <div>settings-form</div>,
}))

const queryData = vi.hoisted(() => ({
  settings: {
    configuration_state: 'active',
    embedding: null,
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
  return render(<KnowledgeSettingsPage knowledgeSpaceId="space-1" />, { wrapper: Wrapper })
}

describe('KnowledgeSettingsPage', () => {
  beforeEach(() => {
    membersQueryMock.data = undefined
    membersQueryMock.isError = false
    membersQueryMock.isPending = true
    membersQueryMock.refetch.mockClear()
    useQueryOptionsMock.mockClear()
  })

  it('keeps the settings form gated while workspace members are loading', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.queryByText('settings-form')).not.toBeInTheDocument()
      expect(screen.getByRole('status')).toBeInTheDocument()
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
})
