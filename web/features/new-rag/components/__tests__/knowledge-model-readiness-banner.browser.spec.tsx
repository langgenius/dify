import type { KnowledgeFsSettingsResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
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

async function renderBanner(capability?: 'index') {
  const { wrapper: QueryProvider } = createConsoleQueryWrapper()
  return render(
    <QueryProvider>
      <KnowledgeModelReadinessBanner capability={capability} knowledgeSpaceId="space-1" />
      <button type="button">After readiness</button>
    </QueryProvider>,
  )
}

describe('KnowledgeModelReadinessBanner', () => {
  beforeEach(async () => {
    await page.viewport(800, 600)
    onTestFinished(guardUnexpectedFetch())
  })

  it.each([
    ['the active profile is healthy', readiness()],
    [
      'validation is waiting for the first document',
      readiness({
        configuration_state: 'pending-validation',
        issues: [{ code: 'missing', field: 'embedding', retryable: true }],
      }),
    ],
  ])('stays hidden after settings settle when %s', async (_, response) => {
    getSettings.mockResolvedValue(response)
    const screen = await renderBanner('index')

    await vi.waitFor(() => expect(getSettings).toHaveBeenCalledOnce())
    await expect.element(screen.getByRole('status')).not.toBeInTheDocument()
    await expect.element(screen.getByRole('alert')).not.toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: 'After readiness' })).toBeVisible()
  })

  it('shows configuration guidance when no model profile can serve the capability', async () => {
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
    const screen = await renderBanner('index')

    await expect
      .element(screen.getByRole('status'))
      .toMatchTextContent('knowledgeSpace.overview.attention.modelReadiness.profilesMissing')
  })

  it('offers the current page as the return target and exposes the action to the keyboard', async () => {
    getSettings.mockResolvedValue(
      readiness({
        capabilities: { ...allCapabilities, index: false },
        configuration_state: 'validation-failed',
        issues: [{ code: 'validation_failed', field: 'embedding', retryable: true }],
      }),
    )
    const user = userEvent
    const screen = await renderBanner('index')

    const alert = screen.getByRole('alert')
    await expect.element(alert).toBeVisible()
    await expect.element(alert).toMatchTextContent('common.api.actionFailed')
    const configure = alert.getByRole('link', {
      name: 'knowledgeSpace.overview.attention.action.configureModels',
    })
    await expect
      .element(configure)
      .toHaveAttribute(
        'href',
        '/datasets/new/space-1/settings?returnTo=%2Fdatasets%2Fnew%2Fspace-1%2Fdocuments%3Fstatus%3Dfailed&capability=index',
      )
    await user.tab()
    await expect.element(configure).toHaveFocus()
  })

  it('removes a transient error after the user retries successfully', async () => {
    getSettings.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue(readiness())
    const screen = await renderBanner()

    const retry = screen.getByRole('button', { name: 'common.operation.retry' })
    await expect.element(retry).toBeVisible()
    await retry.click()

    await expect.element(retry).not.toBeInTheDocument()
    await expect.element(screen.getByRole('alert')).not.toBeInTheDocument()
    expect(getSettings).toHaveBeenCalledTimes(2)
  })
})
