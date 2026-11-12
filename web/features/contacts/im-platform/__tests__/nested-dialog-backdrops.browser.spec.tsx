import { QueryClient } from '@tanstack/react-query'
import { createInstance } from 'i18next'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import MenuDialog from '@/app/components/header/account-setting/menu-dialog'
import common from '@/i18n/locales/en-US/common.json'
import contacts from '@/i18n/locales/en-US/contacts.json'
import { seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { ContactsImPlatformRuntimeProvider } from '../composition'
import { ContactsImPlatformManagementSurface } from '../management-surface'
import { channelSummary } from './fixtures/channel-client'
import { channel, defaultResponse, json } from './fixtures/http'

const network = vi.hoisted(() => ({
  handle: vi.fn<(request: Request) => Promise<Response> | Response>(),
}))
vi.unmock('react-i18next')
// boundary: the HTTP adapter is the server edge below the real contacts runtime.
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

// These surfaces previously lost their scrims when moved under Settings' transparent modal.
// Independent component tests miss that nested-dialog condition. Real rendering must prove
// the modal overlay covers the viewport; no particular radius, spacing or literal color is frozen.
function visibleViewportScrims() {
  const probe = document.createElement('div')
  probe.style.backgroundColor = 'var(--color-background-overlay)'
  document.body.append(probe)
  const overlayColor = getComputedStyle(probe).backgroundColor
  probe.remove()
  return [...document.querySelectorAll<HTMLElement>('body *')].filter((element) => {
    const style = getComputedStyle(element)
    const bounds = element.getBoundingClientRect()
    return (
      overlayColor !== 'rgba(0, 0, 0, 0)' &&
      style.backgroundColor === overlayColor &&
      style.display !== 'none' &&
      style.visibility === 'visible' &&
      Number(style.opacity) > 0 &&
      bounds.left <= 0 &&
      bounds.top <= 0 &&
      bounds.right >= window.innerWidth &&
      bounds.bottom >= window.innerHeight
    )
  }).length
}

async function setup() {
  network.handle.mockImplementation((request) => {
    if (new URL(request.url).pathname.endsWith('/channels'))
      return json({
        channels: [
          channel,
          channelSummary({ id: 'channel-email', kind: 'email', provider: 'resend' }),
        ],
      })
    return defaultResponse(request)
  })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { common, contacts } },
    keySeparator: false,
    interpolation: { escapeValue: false },
  })
  seedSystemFeatures(queryClient, { deployment_edition: 'CLOUD' })
  await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <I18nextProvider i18n={i18n}>
        <NuqsTestingAdapter hasMemory>
          <ContactsImPlatformRuntimeProvider
            organization={{
              canManage: true,
              organizationId: 'workspace-1',
              workspaceId: 'workspace-1',
            }}
          >
            <MenuDialog title="Workspace settings" onClose={vi.fn()}>
              <ContactsImPlatformManagementSurface />
            </MenuDialog>
          </ContactsImPlatformRuntimeProvider>
        </NuqsTestingAdapter>
      </I18nextProvider>
    </QueryClientTestProvider>,
  )
  await expect.element(page.getByRole('group', { name: 'Feishu', exact: true })).toBeVisible()
  expect(visibleViewportScrims()).toBe(0)
  return queryClient
}

it.each(['IM configuration', 'Email configuration', 'replacement', 'deletion', 'sync details'])(
  'dims Settings behind the nested %s and removes the scrim when it closes',
  async (surface) => {
    await page.viewport(1280, 900)
    const client = await setup()
    try {
      let role: 'dialog' | 'alertdialog' = 'dialog'
      let title = /^Configure /i
      if (surface === 'IM configuration' || surface === 'Email configuration') {
        const provider = surface === 'IM configuration' ? 'Feishu' : 'Email'
        await page
          .getByRole('group', { name: provider, exact: true })
          .getByRole('button', { name: `Configure ${provider}` })
          .click()
        title = new RegExp(`^Configure ${provider}$`)
      } else if (surface === 'replacement') {
        await page
          .getByRole('group', { name: 'Slack', exact: true })
          .getByRole('button', { name: 'Slack — Replace' })
          .click()
        role = 'alertdialog'
        title = /^Replace .+ with .+\?$/
      } else if (surface === 'deletion') {
        await page
          .getByRole('group', { name: 'Feishu', exact: true })
          .getByRole('button', { name: 'Delete Feishu' })
          .click()
        role = 'alertdialog'
        title = /^Delete Feishu channel\?$/
      } else {
        await page.getByRole('button', { name: 'View details' }).click()
        title = /^Sync details$/
      }
      const popup = page.getByRole(role, { name: title })
      await expect.element(popup).toBeVisible()
      await expect.poll(visibleViewportScrims).toBe(1)
      if (surface === 'Email configuration') {
        await expect
          .element(popup.getByRole('link', { name: 'Learn more' }))
          .toHaveAttribute('href', 'https://docs.dify.ai/en/cloud/use-dify/nodes/human-input')
      }
      if (surface === 'IM configuration') {
        await popup.getByRole('button', { name: 'Back' }).click()
        await expect.element(popup.getByLabelText('App ID')).toBeVisible()
        expect(visibleViewportScrims()).toBe(1)
      }
      await userEvent.keyboard('{Escape}')
      await expect.element(popup).not.toBeInTheDocument()
      await expect.poll(visibleViewportScrims).toBe(0)
      await expect
        .element(page.getByRole('dialog', { name: 'Workspace settings', exact: true }))
        .toBeVisible()
      expect(network.handle.mock.calls.every(([request]) => request.method === 'GET')).toBe(true)
    } finally {
      client.clear()
    }
  },
)
