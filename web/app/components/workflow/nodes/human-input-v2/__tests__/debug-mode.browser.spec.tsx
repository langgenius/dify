import type { ChannelSummary } from '@dify/contracts/api/console/workspaces/types.gen'
import type { HumanInputV2DebugMode } from '../types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createInstance } from 'i18next'
import { useState } from 'react'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import common from '@/i18n/locales/en-US/common.json'
import contacts from '@/i18n/locales/en-US/contacts.json'
import workflow from '@/i18n/locales/en-US/workflow.json'
import { consoleQuery } from '@/service/console'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import DebugMode from '../components/debug-mode'
import { createChannelsQueryClient } from './channel-fixtures'

const api = vi.hoisted(() => ({ channels: vi.fn() }))
// boundary: workspace channel reads stop at the generated Console transport.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.humanInput.v2.channels.get': api.channels,
    }),
  }
})

vi.unmock('react-i18next')
const i18n = createInstance().use(initReactI18next)

beforeAll(async () => {
  await i18n.init({
    lng: 'en-US',
    fallbackLng: false,
    keySeparator: false,
    resources: { 'en-US': { common, contacts, workflow } },
  })
})

function DebugOwner({
  initial = { enabled: false, channels: [] },
  readonly = false,
  email,
}: {
  initial?: HumanInputV2DebugMode
  readonly?: boolean
  email?: string
}) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <DebugMode value={value} onChange={setValue} readonly={readonly} email={email} />
      <output aria-label="Debug settings">{JSON.stringify(value)}</output>
    </>
  )
}
async function renderOwner(
  props: Parameters<typeof DebugOwner>[0] = {},
  providers?: ChannelSummary['provider'][],
  suppliedClient?: QueryClient,
) {
  const queryClient = suppliedClient ?? createChannelsQueryClient(providers)
  onTestFinished(() => queryClient.clear())
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <DebugOwner {...props} />
      </QueryClientProvider>
    </I18nextProvider>,
  )
}
const label = (channel: string) =>
  ({ email: 'Email', slack: 'Slack', lark: 'Lark', feishu: 'Feishu' })[channel] ?? channel
const channel = (name: string) => page.getByRole('checkbox', { name: label(name) })
const configure = () => page.getByRole('button', { name: 'Configure Debug Mode' })
const toggle = () => page.getByRole('switch', { name: 'Enable Debug Mode' })
const settings = () => page.getByRole('status', { name: 'Debug settings' })

beforeEach(async () => {
  await page.viewport(1100, 700)
  onTestFinished(guardUnexpectedFetch())
  api.channels.mockReset()
})

it('only offers channels configured in the current workspace', async () => {
  await renderOwner()
  await configure().click()
  await expect.element(channel('email')).toBeVisible()
  await expect.element(channel('slack')).toBeVisible()
  await expect.element(channel('feishu')).not.toBeInTheDocument()
  expect(page.getByRole('checkbox').all()).toHaveLength(2)
})

it('explains the final channel guard and keeps its selection after pointer and keyboard activation', async () => {
  await renderOwner({
    initial: { enabled: true, channels: ['email'] },
    email: 'reviewer@example.com',
  })
  await configure().click()
  await expect.element(page.getByText('reviewer@example.com')).toBeVisible()
  await expect.element(channel('email')).toBeChecked()
  await expect.element(channel('email')).toHaveAttribute('aria-disabled', 'true')
  await expect.element(channel('email')).toHaveAccessibleDescription('Keep at least one channel on')
  // Its label is clickable and the checkbox intentionally remains focusable to explain the guard.
  await page.getByRole('dialog').getByText(label('email'), { exact: true }).click()
  await expect.element(channel('email')).toBeChecked()
  await expect.element(channel('email')).toHaveFocus()
  await userEvent.keyboard(' ')
  await expect.element(channel('email')).toBeChecked()
  await expect.element(settings()).toHaveTextContent('{"enabled":true,"channels":["email"]}')
  await channel('slack').click()
  await expect.element(channel('slack')).toBeChecked()
  await expect
    .element(settings())
    .toHaveTextContent('{"enabled":true,"channels":["email","slack"]}')
})

it('protects the last configured selection when imported data retains an unconfigured channel', async () => {
  await renderOwner({ initial: { enabled: true, channels: ['email', 'feishu'] } })
  await configure().click()
  await expect.element(channel('email')).toHaveAttribute('aria-disabled', 'true')
  await expect.element(channel('feishu')).not.toBeInTheDocument()
  await expect.element(configure()).toHaveAccessibleDescription(label('email'))
  await page.getByRole('dialog').getByText(label('email'), { exact: true }).click()
  await expect.element(channel('email')).toBeChecked()
  await expect
    .element(settings())
    .toHaveTextContent('{"enabled":true,"channels":["email","feishu"]}')
})

it('keeps empty workspace configuration unavailable without changing the node', async () => {
  await renderOwner({}, [])
  await configure().click()
  await expect.element(page.getByRole('checkbox')).not.toBeInTheDocument()
  await expect.element(page.getByText('Not configured')).toBeVisible()
  await expect.element(toggle()).toHaveAttribute('aria-disabled', 'true')
  await expect.element(settings()).toHaveTextContent('{"enabled":false,"channels":[]}')
})

it('does not fall back to all channels after a load failure and can retry', async () => {
  const seeded = createChannelsQueryClient()
  const response = seeded.getQueryData(
    consoleQuery.workspaces.current.humanInput.v2.channels.get.queryKey(),
  )
  seeded.clear()
  api.channels.mockRejectedValueOnce(new Error('Service unavailable')).mockResolvedValue(response)
  await renderOwner(
    {},
    undefined,
    new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  )
  await configure().click()
  const error = page.getByRole('alert')
  await expect.element(error).toBeVisible()
  expect(error.element().textContent).toContain("Channels couldn't be loaded")
  await expect.element(page.getByRole('checkbox')).not.toBeInTheDocument()
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect.element(channel('slack')).toBeVisible()
  expect(page.getByRole('checkbox').all()).toHaveLength(2)
})

it('keeps selected channels when enabling debug mode through the real controls', async () => {
  await renderOwner()
  await configure().click()
  await expect.element(channel('email')).not.toBeChecked()
  await expect.element(channel('slack')).not.toBeChecked()
  await channel('slack').click()
  await expect.element(channel('slack')).toBeChecked()
  await expect.element(settings()).toHaveTextContent('{"enabled":false,"channels":["slack"]}')
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('checkbox')).not.toBeInTheDocument()
  await toggle().click()
  await expect.element(toggle()).toBeChecked()
  await expect.element(settings()).toHaveTextContent('{"enabled":true,"channels":["slack"]}')
})

it('shows missing-channel and imported compatibility errors', async () => {
  const queryClient = createChannelsQueryClient()
  onTestFinished(() => queryClient.clear())
  const wrap = (value: HumanInputV2DebugMode) => (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <DebugMode value={value} onChange={vi.fn()} readonly={false} />
      </QueryClientProvider>
    </I18nextProvider>
  )
  const view = await render(wrap({ enabled: true, channels: [] }))
  await expect
    .element(page.getByRole('alert'))
    .toHaveTextContent('Select at least one Debug Mode channel')
  // Imported DSL can contain channel identifiers from a different server version.
  await view.rerender(
    wrap({ enabled: false, channels: ['email', 'legacy_channel'] } as HumanInputV2DebugMode),
  )
  await expect
    .element(page.getByRole('alert'))
    .toHaveTextContent(
      'Unsupported imported channels: legacy_channel. Remove or update them before running this workflow.',
    )
})

it('keeps stored channels and configuration unavailable in read-only mode', async () => {
  await renderOwner({ initial: { enabled: false, channels: ['email', 'slack'] }, readonly: true })
  await expect
    .element(configure())
    .toHaveAccessibleDescription(`${label('email')}, ${label('slack')}`)
  await expect.element(configure()).toBeDisabled()
  await expect.element(toggle()).toHaveAttribute('aria-disabled', 'true')
  await expect
    .element(settings())
    .toHaveTextContent('{"enabled":false,"channels":["email","slack"]}')
})

it('toggles an imported Lark selection without losing Email', async () => {
  await renderOwner({ initial: { enabled: true, channels: ['lark', 'email'] } }, ['resend', 'lark'])
  await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
  await expect
    .element(configure())
    .toHaveAccessibleDescription(`${label('lark')}, ${label('email')}`)
  await configure().click()
  await expect.element(channel('lark')).toBeChecked()
  await channel('lark').click()
  await expect.element(channel('lark')).not.toBeChecked()
  await expect.element(channel('email')).toBeChecked()
  await expect.element(configure()).toHaveAccessibleDescription(label('email'))
  await channel('lark').click()
  await expect.element(channel('lark')).toBeChecked()
  await expect.element(settings()).toHaveTextContent('{"enabled":true,"channels":["email","lark"]}')
})
