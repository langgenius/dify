import type { RecentAppResponse } from '@dify/contracts/api/console/apps/types.gen'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { AppToaster } from '@/app/notifications/app-toaster'
import appMessages from '@/i18n/locales/en-US/app.json'
import explore from '@/i18n/locales/en-US/explore.json'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { AppACLPermission } from '@/utils/permission'
import { ContinueWorkItem } from '../item'

vi.unmock('react-i18next')

const createApp = (overrides: Partial<RecentAppResponse> = {}): RecentAppResponse => ({
  id: 'app-1',
  name: 'Continue App',
  author_name: 'Alice',
  icon_type: 'emoji',
  icon: '🤖',
  icon_background: '#FFEAD5',
  icon_url: null,
  mode: 'chat',
  maintainer: 'maintainer-1',
  updated_at: Date.parse('2026-11-12T12:00:00Z') / 1000,
  permission_keys: [AppACLPermission.Edit],
  ...overrides,
})

async function renderItem(app: RecentAppResponse, rbacEnabled = true) {
  onTestFinished(guardUnexpectedFetch())
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { app: appMessages, explore } },
    keySeparator: false,
    interpolation: { escapeValue: false },
  })
  const { wrapper: Providers } = createConsoleQueryWrapper({
    accountProfile: { id: 'user-1' },
    workspacePermissionKeys: ['app.create_and_management'],
    systemFeatures: { rbac_enabled: rbacEnabled },
  })
  return render(
    <Providers>
      <I18nextProvider i18n={i18n}>
        <button type="button">Before recent app</button>
        <div style={{ width: 400 }}>
          <ContinueWorkItem app={app} />
        </div>
        <AppToaster />
      </I18nextProvider>
    </Providers>,
  )
}

beforeEach(() => vi.setSystemTime(new Date('2026-11-12T12:05:00Z')))
afterEach(() => vi.useRealTimers())

it('names the keyboard entry separately from its author and real relative edit time', async () => {
  const screen = await renderItem(createApp())
  const link = screen.getByRole('link', { name: 'Continue App Chatbot', exact: true })
  await expect.element(link).toHaveAttribute('href', '/app/app-1/configuration')
  await expect.element(link).toHaveAccessibleDescription('Alice Edited 5 minutes ago')
  await expect.element(screen.getByText('Alice')).toBeVisible()
  await expect.element(screen.getByText('Edited 5 minutes ago')).toBeVisible()
  await screen.getByRole('button', { name: 'Before recent app' }).click()
  await userEvent.tab()
  await expect.element(link).toHaveFocus()
  expect(link.element().matches(':focus-visible')).toBe(true)
})

it.each([
  { permissions: [AppACLPermission.AccessConfig], rbac: true, path: 'access-config' },
  {
    permissions: [AppACLPermission.AccessConfig, AppACLPermission.AccessPointView],
    rbac: false,
    path: 'access-point',
  },
])('routes a restricted app to $path with RBAC $rbac', async ({ permissions, rbac, path }) => {
  const screen = await renderItem(createApp({ permission_keys: permissions }), rbac)
  await expect
    .element(screen.getByRole('link', { name: /Continue App/ }))
    .toHaveAttribute('href', `/app/app-1/${path}`)
})

it('explains preview-only access through the real notification for pointer, Enter and Space', async () => {
  const screen = await renderItem(createApp({ permission_keys: [AppACLPermission.Preview] }))
  const card = screen.getByRole('button', { name: 'Continue App Chatbot', exact: true })
  await expect.element(screen.getByRole('link', { name: /Continue App/ })).not.toBeInTheDocument()
  await expect.element(card).toHaveAccessibleDescription('Alice Edited 5 minutes ago')
  const warning = screen.getByRole('dialog', { name: appMessages.noAccessResourcePermission })
  for (const activate of [
    () => card.click(),
    () => userEvent.keyboard('{Enter}'),
    () => userEvent.keyboard(' '),
  ]) {
    await activate()
    await expect.element(warning).toBeVisible()
    await warning.hover()
    await warning.getByRole('button', { name: 'Close notification' }).click()
    await expect.element(warning).not.toBeInTheDocument()
    card.element().focus()
    await expect.element(card).toHaveFocus()
  }
})
