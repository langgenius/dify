import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { queryClientAtom } from 'jotai-tanstack-query'
import { useHydrateAtoms } from 'jotai/utils'
import { render } from '@/test/console/render'
import { KnowledgeSettingsPage } from '../page'

const navigationMock = vi.hoisted(() => ({
  replace: vi.fn(),
  searchParams: new URLSearchParams(),
}))

const serviceMock = vi.hoisted(() => ({
  getExternalAccess: vi.fn(),
  getPermissions: vi.fn(),
  getSettings: vi.fn(),
  getSpace: vi.fn(),
  queryOptions: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ replace: navigationMock.replace }),
  useSearchParams: () => navigationMock.searchParams,
}))

vi.mock('../form', () => ({
  KnowledgeSettingsForm: () => <div>settings-form</div>,
}))

const queryKeys = {
  externalAccess: ['knowledge-fs', 'external-access'],
  permissions: ['knowledge-fs', 'permissions'],
  settings: ['knowledge-fs', 'settings'],
  space: ['knowledge-fs', 'space'],
}

const space = {
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
}

const settings = {
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
}

vi.mock('@/service/client', () => {
  const query = (key: keyof typeof queryKeys, queryFn: () => Promise<unknown>) => ({
    queryOptions: () => {
      const options = { queryFn, queryKey: queryKeys[key] }
      serviceMock.queryOptions(options)
      return options
    },
  })

  return {
    consoleQuery: {
      knowledgeFs: {
        spaces: {
          byControlSpaceId: {
            externalAccess: { get: query('externalAccess', serviceMock.getExternalAccess) },
            get: query('space', serviceMock.getSpace),
            permissions: { get: query('permissions', serviceMock.getPermissions) },
            settings: { get: query('settings', serviceMock.getSettings) },
          },
        },
      },
    },
  }
})

function renderPage({
  seed = false,
  settingsData = settings,
}: {
  seed?: boolean
  settingsData?: typeof settings
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  if (seed) {
    queryClient.setQueryData(queryKeys.space, space)
    queryClient.setQueryData(queryKeys.settings, settingsData)
    queryClient.setQueryData(queryKeys.permissions, { data: [] })
    queryClient.setQueryData(queryKeys.externalAccess, {
      agent_enabled: false,
      mcp_enabled: false,
      revision: 1,
      service_api_enabled: false,
      workflow_enabled: false,
    })
  }
  const Wrapper = ({ children }: { children: ReactNode }) => {
    useHydrateAtoms([[queryClientAtom, queryClient]], { dangerouslyForceHydrate: true })
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
  return {
    queryClient,
    ...render(<KnowledgeSettingsPage knowledgeSpaceId="space-1" />, { wrapper: Wrapper }),
  }
}

describe('KnowledgeSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    navigationMock.searchParams = new URLSearchParams()
    serviceMock.getExternalAccess.mockResolvedValue({
      agent_enabled: false,
      mcp_enabled: false,
      revision: 1,
      service_api_enabled: false,
      workflow_enabled: false,
    })
    serviceMock.getPermissions.mockResolvedValue({ data: [] })
    serviceMock.getSettings.mockResolvedValue(settings)
    serviceMock.getSpace.mockResolvedValue(space)
  })

  it('shows the page skeleton while its server graph is loading', () => {
    serviceMock.getSpace.mockReturnValue(new Promise(() => {}))
    renderPage()

    expect(screen.getByRole('status')).toHaveTextContent('common.loading')
    expect(screen.queryByText('settings-form')).not.toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.settings.basicInfo')).toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.settings.dangerZone')).toBeInTheDocument()
  })

  it('shows the query error state and retries the failed server graph', async () => {
    const user = userEvent.setup()
    serviceMock.getSpace.mockRejectedValueOnce(new Error('unavailable'))
    renderPage()

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    expect(serviceMock.getSpace).toHaveBeenCalledTimes(2)
    expect(await screen.findByText('settings-form')).toBeInTheDocument()
  })

  it('renders the form from cached queries without polling settings', async () => {
    renderPage({ seed: true })

    expect(await screen.findByText('settings-form')).toBeInTheDocument()
    const settingsOptions = serviceMock.queryOptions.mock.calls
      .map(([options]) => options)
      .find((options) => options.queryKey === queryKeys.settings)
    expect(settingsOptions).not.toHaveProperty('refetchInterval')
  })

  it('returns to a validated source page when its blocked capability becomes available', async () => {
    navigationMock.searchParams = new URLSearchParams({
      capability: 'ingest',
      returnTo: '/datasets/new/space-1/documents',
    })
    const blockedSettings = {
      ...settings,
      capabilities: { ...settings.capabilities, ingest: false },
    }
    const { queryClient } = renderPage({ seed: true, settingsData: blockedSettings })
    expect(await screen.findByText('settings-form')).toBeInTheDocument()
    expect(navigationMock.replace).not.toHaveBeenCalled()

    act(() => {
      queryClient.setQueryData(queryKeys.settings, {
        ...blockedSettings,
        capabilities: { ...blockedSettings.capabilities, ingest: true },
      })
    })
    await waitFor(() =>
      expect(navigationMock.replace).toHaveBeenCalledWith('/datasets/new/space-1/documents'),
    )
  })
})
