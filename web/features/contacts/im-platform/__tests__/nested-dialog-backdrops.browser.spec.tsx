import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import MenuDialog from '@/app/components/header/account-setting/menu-dialog'
import { ContactsImPlatformRuntimeProvider } from '../composition'
import { ContactsImPlatformManagementSurface } from '../management-surface'
import { channelSummary } from './fixtures/channel-client'
import { channel, defaultResponse, json } from './fixtures/http'

const network = vi.hoisted(() => ({
  handle: vi.fn<(request: Request) => Promise<Response> | Response>(),
}))
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
vi.mock('@/utils/client', () => ({ isClient: true, isServer: false }))
vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.dify.ai${path}`,
}))

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
  await render(
    <QueryClientProvider client={queryClient}>
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
    </QueryClientProvider>,
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
      let title = /contacts\.imPlatform\.bindingDialog\.configureTitle/
      if (surface === 'IM configuration' || surface === 'Email configuration') {
        const provider = surface === 'IM configuration' ? 'Feishu' : 'Email'
        await page
          .getByRole('group', { name: provider, exact: true })
          .getByRole('button', { name: /contacts\.imPlatform\.action\.configureChannel/ })
          .click()
        if (surface === 'Email configuration') title = /contacts\.imPlatform\.email\.title/
      } else if (surface === 'replacement') {
        await page
          .getByRole('group', { name: 'Slack', exact: true })
          .getByRole('button', { name: /contacts\.imPlatform\.action\.replace/ })
          .click()
        role = 'alertdialog'
        title = /contacts\.imPlatform\.replacement\.title/
      } else if (surface === 'deletion') {
        await page
          .getByRole('group', { name: 'Feishu', exact: true })
          .getByRole('button', { name: /contacts\.imPlatform\.action\.deleteChannel/ })
          .click()
        role = 'alertdialog'
        title = /contacts\.imPlatform\.delete\.title/
      } else {
        await page.getByRole('button', { name: 'contacts.imPlatform.action.viewDetails' }).click()
        title = /contacts\.imPlatform\.details\.title/
      }
      const popup = page.getByRole(role, { name: title })
      await expect.element(popup).toBeVisible()
      await expect.poll(visibleViewportScrims).toBe(1)
      if (surface === 'IM configuration') {
        await popup.getByRole('button', { name: 'contacts.imPlatform.bindingDialog.back' }).click()
        await expect
          .element(popup.getByLabelText('contacts.imPlatform.bindingDialog.field.appId'))
          .toBeVisible()
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
