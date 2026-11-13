import type { KnowledgeFsSettingsResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { zKnowledgeFsSettingsResponse } from '@dify/contracts/api/console/knowledge-fs/zod.gen'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createKnowledgeSpaceFixture } from '@/test/knowledge-space'
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
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ replace: navigationMock.replace }),
  useSearchParams: () => navigationMock.searchParams,
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'knowledgeFs.spaces.byControlSpaceId.externalAccess.get': serviceMock.getExternalAccess,
      'knowledgeFs.spaces.byControlSpaceId.get': serviceMock.getSpace,
      'knowledgeFs.spaces.byControlSpaceId.permissions.get': serviceMock.getPermissions,
      'knowledgeFs.spaces.byControlSpaceId.settings.get': serviceMock.getSettings,
    }),
  }
})

// The form owns editing behavior and has its own suite; this page suite covers loading and routing.
vi.mock('../form', () => ({
  KnowledgeSettingsForm: () => <div>settings-form</div>,
}))

const space = createKnowledgeSpaceFixture({
  permission_keys: ['knowledge_space_access_config', 'knowledge_space_edit'],
})

const settings: KnowledgeFsSettingsResponse = {
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

const settingsQueryKey = () =>
  consoleQuery.knowledgeFs.spaces.byControlSpaceId.settings.get.queryKey({
    input: { params: { control_space_id: 'space-1' } },
  })

const renderPage = () =>
  renderWithConsoleQuery(<KnowledgeSettingsPage knowledgeSpaceId="space-1" />)

describe('KnowledgeSettingsPage', () => {
  beforeEach(() => {
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
    expect(screen.getByText('knowledgeSettings.settings.basicInfo')).toBeInTheDocument()
    expect(screen.getByText('knowledgeSettings.settings.dangerZone')).toBeInTheDocument()
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

  it('returns to a validated source page when its blocked capability becomes available', async () => {
    navigationMock.searchParams = new URLSearchParams({
      capability: 'ingest',
      returnTo: '/datasets/new/space-1/documents',
    })
    const blockedSettings = {
      ...settings,
      capabilities: { ...settings.capabilities, ingest: false },
    }
    serviceMock.getSettings.mockResolvedValue(blockedSettings)
    const { queryClient } = renderPage()
    expect(await screen.findByText('settings-form')).toBeInTheDocument()
    expect(navigationMock.replace).not.toHaveBeenCalled()

    act(() => {
      queryClient.setQueryData(
        settingsQueryKey(),
        zKnowledgeFsSettingsResponse.parse({
          ...blockedSettings,
          capabilities: { ...blockedSettings.capabilities, ingest: true },
        }),
      )
    })
    await waitFor(() =>
      expect(navigationMock.replace).toHaveBeenCalledWith('/datasets/new/space-1/documents'),
    )
  })
})
