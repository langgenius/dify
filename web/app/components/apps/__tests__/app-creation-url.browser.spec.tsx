import type { consoleClient } from '@/service/console'
import { zAppPagination } from '@dify/contracts/api/console/apps/zod.gen'
import { zGetFeaturesResponse } from '@dify/contracts/api/console/features/zod.gen'
import { createInstance } from 'i18next'
import { NuqsAdapter } from 'nuqs/adapters/react'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import appMessages from '@/i18n/locales/en-US/app.json'
import common from '@/i18n/locales/en-US/common.json'
import navigation from '@/i18n/locales/en-US/navigation.json'
import time from '@/i18n/locales/en-US/time.json'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { List } from '../list'

const api = vi.hoisted(() => ({
  apps: vi.fn<typeof consoleClient.apps.get>(),
  create: vi.fn<typeof consoleClient.apps.post>(),
  push: vi.fn(),
}))
vi.mock('react-i18next', async (importOriginal) => importOriginal())
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useRouter: () => ({ push: api.push, replace: vi.fn() }),
  usePathname: () => '/apps',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.get': api.apps,
      'apps.post': api.create,
      'apps.starred.get': api.apps,
      'explore.apps.get': async () => ({ recommended_apps: [], categories: [] }),
      'features.get': async () => zGetFeaturesResponse.parse({}),
      'tags.get': async () => [],
      'workspaces.current.members.get': async () => ({ accounts: [] }),
    }),
  }
})
vi.mock('@/utils/create-app-tracking', () => ({ trackCreateApp: vi.fn() }))

const testPageUrl = window.location.href
const currentUrl = () => `${window.location.pathname}${window.location.search}`
afterEach(() => window.history.replaceState(null, '', testPageUrl))

// The list renders behind the page the user came from, so Back can be checked against it.
async function setup(listUrl: string) {
  await page.viewport(1280, 800)
  window.history.replaceState(null, '', '/previous-page')
  window.history.pushState(null, '', listUrl)
  api.apps
    .mockReset()
    .mockResolvedValue(
      zAppPagination.parse({ data: [], page: 1, limit: 30, has_more: false, total: 0 }),
    )
  api.create
    .mockReset()
    .mockImplementation(async ({ body }) =>
      createAppDetailFixture({ id: 'created-app', mode: body.mode, maintainer: 'user-1' }),
    )
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { app: appMessages, common, navigation, time } },
    keySeparator: false,
    interpolation: { escapeValue: false },
  })
  const { queryClient } = createConsoleQueryWrapper({
    accountProfile: { id: 'user-1' },
    workspacePermissionKeys: ['app.create_and_management'],
    features: {},
    systemFeatures: { rbac_enabled: true, enable_learn_app: false },
  })
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <NuqsAdapter>
        <I18nextProvider i18n={i18n}>
          <div className="flex h-screen flex-col">
            <List />
          </div>
        </I18nextProvider>
      </NuqsAdapter>
    </QueryClientTestProvider>,
  )
  const goBack = async (url: string) => {
    window.history.back()
    await expect.poll(currentUrl).toBe(url)
  }
  return { screen, goBack }
}

it('returns to the list in one Back step after closing a dialog that Forward reopened', async () => {
  const { screen, goBack } = await setup('/apps?category=workflow')
  await screen.getByRole('button', { name: 'Create', exact: true }).click()
  await screen.getByRole('menuitem', { name: 'Start from a template' }).click()
  const templates = screen.getByRole('dialog', { name: 'Create from Template' })
  await expect.element(templates).toBeVisible()
  await expect.poll(currentUrl).toBe('/apps?category=workflow&create=template')

  await userEvent.keyboard('{Escape}')
  await expect.element(templates).not.toBeInTheDocument()
  await expect.poll(currentUrl).toBe('/apps?category=workflow')

  window.history.forward()
  await expect.element(templates).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(templates).not.toBeInTheDocument()
  await expect.poll(currentUrl).toBe('/apps?category=workflow')

  await goBack('/previous-page')
})

it('closes a creation dialog when browser Back leaves its entry', async () => {
  const { screen, goBack } = await setup('/apps')
  await screen.getByRole('button', { name: 'Create', exact: true }).click()
  await screen.getByRole('menuitem', { name: 'Start from a template' }).click()
  const templates = screen.getByRole('dialog', { name: 'Create from Template' })
  await expect.element(templates).toBeVisible()

  await goBack('/apps')
  await expect.element(templates).not.toBeInTheDocument()
})

it('closes a dialog opened from a link in place, keeping Back to the previous page', async () => {
  const { screen, goBack } = await setup('/apps?category=chat&create=blank&mode=workflow')
  const blank = screen.getByRole('dialog', { name: 'Create from Blank' })
  await expect.element(blank.getByRole('combobox', { name: 'Types' })).toHaveTextContent('Workflow')
  expect(api.create).not.toHaveBeenCalled()

  await userEvent.keyboard('{Escape}')
  await expect.element(blank).not.toBeInTheDocument()
  await expect.poll(currentUrl).toBe('/apps?category=chat')
  await goBack('/previous-page')
})

it('switches from a linked blank dialog to templates in the same history entry', async () => {
  const { screen, goBack } = await setup('/apps?category=workflow&create=blank')
  const blank = screen.getByRole('dialog', { name: 'Create from Blank' })
  await expect.element(blank.getByRole('combobox', { name: 'Types' })).toHaveTextContent('Workflow')
  await blank.getByRole('button', { name: 'Start from a template' }).click()
  const templates = screen.getByRole('dialog', { name: 'Create from Template' })
  await expect.element(templates).toBeVisible()
  await expect.poll(currentUrl).toBe('/apps?category=workflow&create=template')

  await userEvent.keyboard('{Escape}')
  await expect.element(templates).not.toBeInTheDocument()
  await expect.poll(currentUrl).toBe('/apps?category=workflow')
  await goBack('/previous-page')
})

it('submits the selected blank app on confirmation and keeps the dialog open during navigation', async () => {
  const { screen } = await setup('/apps?create=blank&mode=workflow')
  const blank = screen.getByRole('dialog', { name: 'Create from Blank' })
  await blank.getByRole('combobox', { name: 'Types' }).click()
  await screen.getByRole('option', { name: 'Chatbot' }).click()
  await blank.getByRole('textbox', { name: 'App name' }).fill('Linked workflow')
  expect(api.create).not.toHaveBeenCalled()
  await blank.getByRole('button', { name: /^Create\b/ }).click()

  await expect.poll(() => api.push.mock.lastCall).toEqual(['/app/created-app/configuration'])
  expect(api.create).toHaveBeenCalledExactlyOnceWith({
    body: expect.objectContaining({ mode: 'chat', name: 'Linked workflow' }),
  })
  await expect.element(blank).toBeVisible()
})
