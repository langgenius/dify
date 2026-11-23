import type { ExternalAgentAppReferenceResponse } from '@dify/contracts/api/console/external-agents/types.gen'
import type { ConsoleClient } from '@/service/console'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import agentRoster from '@/i18n/locales/en-US/agent-roster.json'
import app from '@/i18n/locales/en-US/app.json'
import { consoleQuery } from '@/service/console'
import { createExternalAgentReferences } from '@/test/console/external-agents'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createGifFile } from '@/test/fixtures/image-files'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { ExternalAgentUsedInApps } from '../used-in-apps'

// boundary: use real translations for the rendered Used in apps section.
vi.mock('react-i18next', async (original) => original())

const requests = vi.hoisted(() => ({
  references: vi.fn<ConsoleClient['externalAgents']['byAgentId']['references']['get']>(),
}))

// boundary: mock the references endpoint; generated query options and AppIcon remain real.
vi.mock('@/service/console', async (original) => {
  const actual = await original<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'externalAgents.byAgentId.references.get': requests.references,
    }),
  }
})

const agentId = '22222222-2222-4222-8222-222222222222'
const appReference = (
  overrides: Partial<ExternalAgentAppReferenceResponse> = {},
): ExternalAgentAppReferenceResponse => ({
  app_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  name: 'Approvals',
  mode: 'workflow',
  node_ids: ['external'],
  icon_type: null,
  icon: null,
  icon_background: null,
  icon_url: null,
  ...overrides,
})

async function setup() {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    keySeparator: false,
    resources: { 'en-US': { agentRoster, app } },
    interpolation: { escapeValue: false },
  })
  const { queryClient, wrapper: QueryProvider } = createConsoleQueryWrapper()
  onTestFinished(() => queryClient.clear())
  await render(
    <QueryProvider>
      <I18nextProvider i18n={i18n}>
        <ExternalAgentUsedInApps agentId={agentId} />
      </I18nextProvider>
    </QueryProvider>,
  )
  await expect.element(page.getByRole('link', { name: /Approvals/ })).toBeVisible()
  return queryClient
}

beforeEach(({ onTestFinished }) => {
  requests.references.mockReset()
  onTestFinished(guardUnexpectedFetch())
})

it('uses the referenced App emoji and background instead of its workflow mode icon', async () => {
  requests.references.mockResolvedValue(
    createExternalAgentReferences({
      apps: [appReference({ icon_type: 'emoji', icon: '🐙', icon_background: '#E4FBCC' })],
    }),
  )
  await setup()
  const link = page.getByRole('link', { name: /Approvals/ })
  const emoji = link.getByText('🐙', { exact: true })
  await expect.element(emoji).toBeVisible()
  expect(getComputedStyle(emoji.element()).backgroundColor).toBe('rgb(228, 251, 204)')
  await expect.element(link.getByText('🔄', { exact: true })).not.toBeInTheDocument()
  expect(requests.references).toHaveBeenCalledExactlyOnceWith({ params: { agent_id: agentId } })
})

it('loads the display URL and replaces it with the latest App icon after a references refetch', async () => {
  const firstUrl = URL.createObjectURL(createGifFile('first.gif'))
  const secondUrl = URL.createObjectURL(createGifFile('updated.gif'))
  onTestFinished(() => {
    URL.revokeObjectURL(firstUrl)
    URL.revokeObjectURL(secondUrl)
  })
  const reference = appReference({
    icon_type: 'image',
    icon: 'opaque-upload-id',
    icon_url: firstUrl,
  })
  requests.references.mockResolvedValue(createExternalAgentReferences({ apps: [reference] }))
  const queryClient = await setup()
  const link = page.getByRole('link', { name: /Approvals/ })
  await expect.poll(() => link.element().querySelector('img')?.naturalWidth).toBe(1)
  expect(link.element().querySelector('img')?.currentSrc).toBe(firstUrl)

  requests.references.mockResolvedValue(
    createExternalAgentReferences({ apps: [{ ...reference, icon_url: secondUrl }] }),
  )
  await queryClient.refetchQueries({
    queryKey: consoleQuery.externalAgents.byAgentId.references.get.queryOptions({
      input: { params: { agent_id: agentId } },
    }).queryKey,
  })
  await expect.poll(() => link.element().querySelector('img')?.currentSrc).toBe(secondUrl)
  await expect.poll(() => link.element().querySelector('img')?.naturalWidth).toBe(1)
  expect(requests.references).toHaveBeenCalledTimes(2)
})

it('keeps readable fallbacks when icon metadata or an uploaded image URL is unavailable', async () => {
  requests.references.mockResolvedValue(
    createExternalAgentReferences({
      apps: [
        appReference(),
        appReference({
          app_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          name: 'Support',
          mode: 'advanced-chat',
          icon_type: 'image',
          icon: 'opaque-upload-id',
        }),
      ],
    }),
  )
  await setup()
  await expect
    .element(page.getByRole('link', { name: /Approvals/ }).getByText('🔄', { exact: true }))
    .toBeVisible()
  const support = page.getByRole('link', { name: /Support/ })
  await expect.element(support.getByText('💬', { exact: true })).toBeVisible()
  expect(support.element().querySelector('img')).toBeNull()
  expect(requests.references).toHaveBeenCalledTimes(1)
})
