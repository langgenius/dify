import { zGetWorkspacesCurrentHumanInputV2ChannelProvidersResponse } from '@dify/contracts/api/console/workspaces/zod.gen'
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
import { installFakeApi } from '@/test/fake-api'
import { ContactsImPlatformAccountSettingPage } from '../account-setting-page'
import { channelSummary } from './fixtures/channel-client'
import { channel as feishuChannel, providers, syncRun } from './fixtures/http'

// Channel ids are UUIDs in the contract.
const channel = { ...feishuChannel, id: '00000000-0000-4000-8000-000000000001' }

vi.unmock('react-i18next')

it('deletes an IM channel through the settings API only after confirmation and refreshes the list', async () => {
  const email = channelSummary({ id: 'channel-email', kind: 'email', provider: 'resend' })
  const deletion = createDeferred<{ channel_id: string }>()
  let removed = false
  const fake = installFakeApi({
    console: {
      workspaces: {
        current: {
          humanInput: {
            v2: {
              channelProviders: {
                get: () =>
                  zGetWorkspacesCurrentHumanInputV2ChannelProvidersResponse.parse(providers),
              },
              channels: {
                get: () => ({ channels: removed ? [email] : [email, channel] }),
                im: { byChannelId: { delete: () => deletion.promise } },
              },
              imSyncRuns: { latest: { get: () => ({ run: syncRun() }) } },
            },
          },
        },
      },
    },
  })
  onTestFinished(fake)
  const removeChannel = fake.console.workspaces.current.humanInput.v2.channels.im.byChannelId.delete
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
    expect(removeChannel).not.toHaveBeenCalled()
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect.element(confirmation).not.toBeInTheDocument()
    expect(removeChannel).not.toHaveBeenCalled()
    await expect.element(imCard).toMatchTextContent(/saved-tenant/)

    await imCard.getByRole('button', { name: 'Delete Feishu' }).click()
    await confirmation.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect
      .poll(() => removeChannel)
      .toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          params: { channel_id: channel.id },
          query: { expected_config_version: channel.config_version },
        }),
      )
    await expect
      .element(confirmation.getByRole('button', { name: 'Cancel', exact: true }))
      .toBeDisabled()

    removed = true
    deletion.resolve({ channel_id: channel.id })
    await expect.element(confirmation).not.toBeInTheDocument()
    await expect.element(imCard.getByRole('button', { name: 'Feishu — Connect' })).toBeVisible()
    await expect.element(imCard).not.toMatchTextContent(/saved-tenant/)
    await expect.element(page.getByRole('button', { name: 'Delete Email' })).toBeVisible()
    expect(removeChannel).toHaveBeenCalledOnce()
  } finally {
    deletion.resolve({ channel_id: channel.id })
    client.clear()
  }
})
