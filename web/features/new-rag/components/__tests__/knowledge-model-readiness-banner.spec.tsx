import type { KnowledgeFsSettingsResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { KnowledgeModelReadinessBanner } from '../knowledge-model-readiness-banner'

const getSettings = vi.hoisted(() => vi.fn<() => Promise<KnowledgeFsSettingsResponse>>())

vi.mock('@/next/navigation', () => ({
  usePathname: () => '/datasets/new/space-1/documents',
  useSearchParams: () => new URLSearchParams('status=failed'),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'knowledgeFs.spaces.byControlSpaceId.settings.get': getSettings,
    }),
  }
})

const allCapabilities = {
  deep: true,
  index: true,
  ingest: true,
  query: true,
  research: true,
  source_sync: true,
}

const readiness = (
  overrides: Partial<KnowledgeFsSettingsResponse> = {},
): KnowledgeFsSettingsResponse => ({
  active_profile_available: true,
  active_profile_revisions: { embedding: 1, retrieval: 1 },
  capabilities: allCapabilities,
  configuration_state: 'active',
  embedding: null,
  issues: [],
  retrieval: null,
  revision: 1,
  ...overrides,
})

const configureModelsLink = () =>
  screen.queryByRole('link', { name: 'knowledgeSpace.overview.attention.action.configureModels' })

describe('KnowledgeModelReadinessBanner', () => {
  it.each([
    ['the active profile is healthy', readiness()],
    [
      'configuration is complete but the first profile is not active yet',
      readiness({
        active_profile_available: false,
        active_profile_revisions: { embedding: null, retrieval: null },
        capabilities: {
          ...allCapabilities,
          deep: false,
          index: false,
          query: false,
          research: false,
        },
      }),
    ],
    [
      'configuration is complete despite an unrelated runtime issue',
      readiness({
        capabilities: { ...allCapabilities, research: false },
        issues: [{ code: 'unavailable', field: 'publication', retryable: true }],
      }),
    ],
    [
      'validation is waiting for the first document',
      readiness({
        configuration_state: 'pending-validation',
        issues: [{ code: 'missing', field: 'embedding', retryable: true }],
      }),
    ],
  ])('stays hidden when %s', async (_, response) => {
    getSettings.mockResolvedValue(response)

    renderWithConsoleQuery(
      <KnowledgeModelReadinessBanner capability="index" knowledgeSpaceId="space-1" />,
    )

    await waitFor(() => expect(getSettings).toHaveBeenCalled())
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows configuration guidance when model setup is required', async () => {
    getSettings.mockResolvedValue(
      readiness({
        active_profile_available: false,
        active_profile_revisions: { embedding: null, retrieval: null },
        capabilities: Object.fromEntries(
          Object.keys(allCapabilities).map((key) => [key, false]),
        ) as KnowledgeFsSettingsResponse['capabilities'],
        configuration_state: 'setup-required',
        issues: [{ code: 'missing', field: 'embedding', retryable: false }],
      }),
    )

    renderWithConsoleQuery(
      <KnowledgeModelReadinessBanner capability="index" knowledgeSpaceId="space-1" />,
    )

    expect(await screen.findByRole('status')).toHaveTextContent(
      'knowledgeSpace.overview.attention.modelReadiness.profilesMissing',
    )
  })

  it('links validation failures to settings and preserves the current page', async () => {
    getSettings.mockResolvedValue(
      readiness({
        capabilities: { ...allCapabilities, index: false },
        configuration_state: 'validation-failed',
        issues: [{ code: 'validation_failed', field: 'embedding', retryable: true }],
      }),
    )

    renderWithConsoleQuery(
      <KnowledgeModelReadinessBanner capability="index" knowledgeSpaceId="space-1" />,
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('common.api.actionFailed')
    expect(alert).toHaveTextContent('knowledgeSpace.overview.attention.modelReadiness.description')
    expect(configureModelsLink()).toHaveAttribute(
      'href',
      '/datasets/new/space-1/settings?returnTo=%2Fdatasets%2Fnew%2Fspace-1%2Fdocuments%3Fstatus%3Dfailed&capability=index',
    )
  })

  it('keeps a readiness fetch failure separate and retryable', async () => {
    const user = userEvent.setup()
    getSettings.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue(readiness())

    renderWithConsoleQuery(<KnowledgeModelReadinessBanner knowledgeSpaceId="space-1" />)
    await user.click(await screen.findByRole('button', { name: 'common.operation.retry' }))

    expect(configureModelsLink()).not.toBeInTheDocument()
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'common.operation.retry' }),
      ).not.toBeInTheDocument(),
    )
    expect(getSettings).toHaveBeenCalledTimes(2)
  })
})
