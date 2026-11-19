import { QueryClient } from '@tanstack/react-query'
import { createInstance } from 'i18next'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { I18nextProvider } from 'react-i18next'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import common from '@/i18n/locales/en-US/common.json'
import contacts from '@/i18n/locales/en-US/contacts.json'
import { seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { ContactsImPlatformRuntimeProvider } from '../composition'
import { ContactsImPlatformManagementSurface } from '../management-surface'
import { channelSummary } from './fixtures/channel-client'
import { defaultResponse, json } from './fixtures/http'

const network = vi.hoisted(() => ({
  handle: vi.fn<(request: Request) => Promise<Response> | Response>(),
}))
vi.unmock('react-i18next')
// boundary: catalog and configured channels arrive through the generated client's HTTP adapter.
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

async function setup(hasActiveIM: boolean) {
  network.handle.mockImplementation((request) => {
    if (new URL(request.url).pathname.endsWith('/channels'))
      return json({ channels: hasActiveIM ? [channelSummary({ provider: 'slack' })] : [] })
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
  await render(
    <QueryClientTestProvider queryClient={client}>
      <I18nextProvider i18n={i18n}>
        <NuqsTestingAdapter>
          <ContactsImPlatformRuntimeProvider
            organization={{
              canManage: true,
              organizationId: 'workspace-1',
              workspaceId: 'workspace-1',
            }}
          >
            <ContactsImPlatformManagementSurface />
          </ContactsImPlatformRuntimeProvider>
        </NuqsTestingAdapter>
      </I18nextProvider>
    </QueryClientTestProvider>,
  )
  return client
}

describe.each([
  { hasActiveIM: false, action: 'Connect' },
  { hasActiveIM: true, action: 'Replace' },
])('$action an IM provider from the catalog', ({ hasActiveIM, action }) => {
  it.each([
    { name: 'Microsoft Teams', fields: ['Tenant ID', 'Client ID', 'Client Secret'] },
    { name: 'WeCom', fields: ['Corp ID', 'Agent ID', 'Secret'] },
  ])('shows $name and opens its credential form', async ({ name, fields }) => {
    const client = await setup(hasActiveIM)
    try {
      const provider = page.getByRole('group', { name, exact: true })
      await expect.element(provider).toBeVisible()
      await provider.getByRole('button', { name: `${name} — ${action}` }).click()
      if (hasActiveIM) {
        const confirmation = page.getByRole('alertdialog', { name: `Replace Slack with ${name}?` })
        await expect.element(confirmation).toBeVisible()
        await confirmation.getByRole('button', { name: 'Replace', exact: true }).click()
      }
      const dialog = page.getByRole('dialog')
      for (const field of fields) await expect.element(dialog.getByLabelText(field)).toBeVisible()
      await dialog.getByRole('button', { name: 'Close', exact: true }).click()
      await expect.element(dialog).not.toBeInTheDocument()
    } finally {
      client.clear()
    }
  })
})
