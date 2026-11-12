import type { ConsoleClient } from '@/service/console'
import { ORPCError } from '@orpc/client'
import { createInstance } from 'i18next'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { I18nextProvider } from 'react-i18next'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import agentRoster from '@/i18n/locales/en-US/agent-roster.json'
import app from '@/i18n/locales/en-US/app.json'
import common from '@/i18n/locales/en-US/common.json'
import {
  createExternalAgentCapabilities,
  createExternalAgentDetail,
  createExternalAgentReferences,
} from '@/test/console/external-agents'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { ExternalAgentOverviewPage } from '../page'

// boundary: the real i18n instance supplies the labels for the rendered feature.
vi.mock('react-i18next', async (original) => original())
const requests = vi.hoisted(() => ({
  detail: vi.fn<ConsoleClient['externalAgents']['byAgentId']['get']>(),
  references: vi.fn<ConsoleClient['externalAgents']['byAgentId']['references']['get']>(),
  capabilities: vi.fn<ConsoleClient['externalAgents']['capabilities']['get']>(),
  tracing: vi.fn<ConsoleClient['externalAgents']['byAgentId']['tracing']['put']>(),
  members: vi.fn<ConsoleClient['workspaces']['current']['members']['get']>(),
  leave: vi.fn<ConsoleClient['externalAgentTests']['leavePage']['post']>(),
}))
// boundary: replace backend responses while preserving generated options and mutation invalidation.
vi.mock('@/service/console', async (original) => {
  const actual = await original<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'externalAgents.byAgentId.get': requests.detail,
      'externalAgents.byAgentId.references.get': requests.references,
      'externalAgents.capabilities.get': requests.capabilities,
      'externalAgents.byAgentId.tracing.put': requests.tracing,
      'workspaces.current.members.get': requests.members,
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'externalAgentTests.leavePage.post': requests.leave,
    }),
  }
})
// boundary: this component test has no application router; navigation is inspected through links.
vi.mock('@/next/navigation', async (original) => ({
  ...(await original<typeof import('@/next/navigation')>()),
  useRouter: () => ({ push: vi.fn() }),
}))

let detail: ReturnType<typeof createExternalAgentDetail>
async function setup(role: 'owner' | 'normal' = 'owner') {
  await page.viewport(1512, 982)
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    keySeparator: false,
    resources: { 'en-US': { agentRoster, app, common } },
    interpolation: { escapeValue: false },
  })
  const { queryClient, wrapper: QueryProvider } = createConsoleQueryWrapper({
    currentWorkspace: { role, id: detail.asset.tenant_id },
  })
  onTestFinished(() => queryClient.clear())
  return render(
    <QueryProvider>
      <NuqsTestingAdapter hasMemory>
        <I18nextProvider i18n={i18n}>
          <div className="flex h-screen min-w-0 flex-col">
            <ExternalAgentOverviewPage agentId={detail.asset.id} />
          </div>
        </I18nextProvider>
      </NuqsTestingAdapter>
    </QueryProvider>,
  )
}
beforeEach(({ onTestFinished }) => {
  vi.clearAllMocks()
  onTestFinished(guardUnexpectedFetch())
  detail = createExternalAgentDetail()
  detail.asset.name = 'Live Reviewer'
  requests.detail.mockImplementation(async () => detail)
  requests.capabilities.mockResolvedValue(createExternalAgentCapabilities())
  requests.references.mockResolvedValue(
    createExternalAgentReferences({
      apps: [
        {
          app_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          name: 'Approvals',
          mode: 'workflow',
          node_ids: ['external'],
        },
      ],
    }),
  )
  requests.members.mockResolvedValue({ accounts: [] })
  requests.leave.mockResolvedValue({ result: 'success' })
  requests.tracing.mockImplementation(async ({ body }) => {
    detail = { ...detail, asset: { ...detail.asset, tracing_enabled: body.enabled } }
    return detail.asset
  })
})

it('renders saved asset and service declarations and waits for the server before changing tracing', async () => {
  await setup()
  await expect
    .element(page.getByRole('heading', { name: 'Live Reviewer', exact: true }))
    .toBeVisible()
  await expect.element(page.getByText('Example Agent Services', { exact: true })).toBeVisible()
  await expect
    .element(page.getByRole('link', { name: /Approvals/ }))
    .toHaveAttribute('href', '/app/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/overview')
  await expect
    .element(page.getByRole('link', { name: 'View documentation', exact: true }))
    .toHaveAttribute('href', 'https://agents.example.test/docs')
  const example = page.getByText(
    'Review this contract and identify clauses that may expose us to risk.',
    { exact: true },
  )
  await page.getByRole('button', { name: 'Example requests', exact: true }).first().click()
  await expect.element(example).toBeVisible()
  const waiting = createDeferred<ReturnType<typeof createExternalAgentDetail>['asset']>()
  requests.tracing.mockImplementation(async ({ body }) => {
    await waiting.promise
    detail = { ...detail, asset: { ...detail.asset, tracing_enabled: body.enabled } }
    return detail.asset
  })
  const tracing = page.getByRole('switch', { name: 'Tracing', exact: true })
  await expect.element(tracing).toBeChecked()
  await tracing.click()
  await expect.element(tracing).toBeDisabled()
  await expect.element(tracing).toBeChecked()
  waiting.resolve({ ...detail.asset, tracing_enabled: false })
  await expect.element(tracing).not.toBeChecked()
  await expect.element(tracing).toBeEnabled()
  expect(requests.tracing.mock.lastCall?.[0]).toEqual({
    params: { agent_id: detail.asset.id },
    body: { enabled: false },
  })
})

it('does not replace missing or forbidden server data with sample agents', async () => {
  requests.detail.mockRejectedValue(new ORPCError('NOT_FOUND', { status: 404 }))
  await setup()
  await expect
    .element(page.getByRole('alert'))
    .toHaveTextContent('This external agent is no longer available.')
  await expect
    .element(page.getByRole('heading', { name: 'Contract Review Agent', exact: true }))
    .not.toBeInTheDocument()
  expect(requests.references).not.toHaveBeenCalled()
})

it('keeps detail, references and test requests unavailable for the aggregate-only role', async () => {
  await setup('normal')
  await expect
    .element(page.getByRole('alert'))
    .toHaveTextContent('You do not have access to this external agent.')
  expect(requests.detail).not.toHaveBeenCalled()
  expect(requests.references).not.toHaveBeenCalled()
  expect(requests.capabilities).not.toHaveBeenCalled()
})
