import { QueryClient } from '@tanstack/react-query'
import { createInstance } from 'i18next'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { I18nextProvider } from 'react-i18next'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import MenuDialog from '@/app/components/header/account-setting/menu-dialog'
import common from '@/i18n/locales/en-US/common.json'
import contacts from '@/i18n/locales/en-US/contacts.json'
import { seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createDeferred } from '@/test/deferred'
import { ContactsImPlatformAccountSettingPage } from '../account-setting-page'
import { channelSummary } from './fixtures/channel-client'
import { channel, defaultResponse, json } from './fixtures/http'

const network = vi.hoisted(() => ({
  handle: vi.fn<(request: Request) => Promise<Response> | Response>(),
}))
vi.unmock('react-i18next')
// boundary: isolate the server while retaining the settings entry point and generated client.
vi.mock('@/service/base', async () => {
  const { httpErrorFromResponse } = await import('@/service/http-error')
  return {
    request: async (_url: string, _init: RequestInit, options: { request: Request }) => {
      const response = await network.handle(options.request)
      if (!response.ok) throw await httpErrorFromResponse(response)
      return response
    },
  }
})

it('deletes an IM channel through the settings API only after confirmation and refreshes the list', async () => {
  const email = channelSummary({ id: 'channel-email', kind: 'email', provider: 'resend' })
  const deletion = createDeferred<Response>()
  let removed = false
  network.handle.mockImplementation((request) => {
    const url = new URL(request.url)
    if (url.pathname.endsWith('/channels'))
      return json({ channels: removed ? [email] : [email, channel] })
    if (request.method === 'DELETE') return deletion.promise
    return defaultResponse(request)
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  seedSystemFeatures(client, { deployment_edition: 'CLOUD' })
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { common, contacts } },
    keySeparator: false,
    interpolation: { escapeValue: false },
  })
  const deletions = () =>
    network.handle.mock.calls
      .map(([request]) => request)
      .filter((request) => request.method === 'DELETE')

  try {
    await render(
      <QueryClientTestProvider queryClient={client}>
        <I18nextProvider i18n={i18n}>
          <NuqsTestingAdapter hasMemory>
            <MenuDialog title="Workspace settings" onClose={vi.fn()}>
              <ContactsImPlatformAccountSettingPage canManage organizationId="workspace-1" />
            </MenuDialog>
          </NuqsTestingAdapter>
        </I18nextProvider>
      </QueryClientTestProvider>,
    )
    const imCard = page.getByRole('group', { name: 'Feishu', exact: true })
    await expect.element(imCard).toMatchTextContent(/saved-tenant/)
    await imCard.getByRole('button', { name: 'Delete Feishu' }).click()
    const confirmation = page.getByRole('alertdialog', { name: 'Delete Feishu channel?' })
    await expect.element(confirmation).toBeVisible()
    expect(deletions()).toHaveLength(0)
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect.element(confirmation).not.toBeInTheDocument()
    expect(deletions()).toHaveLength(0)
    await expect.element(imCard).toMatchTextContent(/saved-tenant/)

    await imCard.getByRole('button', { name: 'Delete Feishu' }).click()
    await confirmation.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect.poll(() => deletions().length).toBe(1)
    const request = deletions()[0]!
    const url = new URL(request.url)
    expect(url.pathname).toBe(
      `/console/api/workspaces/current/human-input/v2/channels/im/${channel.id}`,
    )
    expect(url.searchParams.get('expected_config_version')).toBe(channel.config_version)
    await expect
      .element(confirmation.getByRole('button', { name: 'Cancel', exact: true }))
      .toBeDisabled()

    removed = true
    deletion.resolve(json({ channel_id: channel.id }))
    await expect.element(confirmation).not.toBeInTheDocument()
    await expect.element(imCard.getByRole('button', { name: 'Feishu — Connect' })).toBeVisible()
    await expect.element(imCard).not.toMatchTextContent(/saved-tenant/)
    await expect.element(page.getByRole('button', { name: 'Delete Email' })).toBeVisible()
    expect(deletions()).toHaveLength(1)
  } finally {
    deletion.resolve(json({ channel_id: channel.id }))
    client.clear()
  }
})
