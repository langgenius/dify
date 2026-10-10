import type { Import } from '@dify/contracts/api/console/apps/types.gen'
import type {
  GetExploreAppsResponse,
  RecommendedAppDetailResponse,
} from '@dify/contracts/api/console/explore/types.gen'
import { QueryClient } from '@tanstack/react-query'
import { page, userEvent } from 'vite-plus/test/browser'
import { cleanup, render } from 'vitest-browser-react'
import { AppInfoView } from '@/app/components/app-sidebar/app-info'
import TemplateApps from '@/app/components/app/create-app-dialog/app-list'
import { AppCard } from '@/app/components/apps/app-card'
import { emojiCatalogOptions } from '@/app/components/base/icon-picker/emoji-data'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { consoleQuery } from '@/service/console'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { seedWorkspacePermissionsQuery } from '@/test/console/workspace-permissions'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { AppACLPermission } from '@/utils/permission'

const { transport, push, replace } = vi.hoisted(() => ({
  transport: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
}))

vi.mock('@/service/console/browser', () => ({ consoleBrowserLink: { call: transport } }))
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  useParams: () => ({}),
}))

const app = createAppDetailFixture({
  id: 'menu-app',
  name: 'Original app',
  mode: 'chat',
  maintainer: 'user-1',
  permission_keys: [AppACLPermission.Edit, AppACLPermission.ViewLayout],
  icon_type: 'emoji',
  icon: '🤖',
  icon_background: '#FFEAD5',
})
const clients: QueryClient[] = []

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete
    reject = fail
  })
  return { promise, resolve, reject }
}

function createClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  seedAccountProfileQuery(client, { id: 'user-1' })
  seedWorkspacePermissionsQuery(client, ['app.create_and_management'])
  seedSystemFeatures(client, { rbac_enabled: true, webapp_auth: { enabled: false } })
  client.setQueryData(consoleQuery.tags.get.queryKey({ input: { query: { type: 'app' } } }), [])
  client.setQueryData(emojiCatalogOptions.queryKey, [])
  return client
}

async function renderOwner(owner: 'sidebar' | 'card') {
  return render(
    <QueryClientTestProvider queryClient={createClient()}>
      <EventEmitterContextProvider>
        {owner === 'sidebar' ? (
          <AppInfoView appDetail={app} expand />
        ) : (
          <ul className="w-96">
            <AppCard app={app} />
          </ul>
        )}
      </EventEmitterContextProvider>
    </QueryClientTestProvider>,
  )
}

async function openEdit(
  screen: Awaited<ReturnType<typeof renderOwner>>,
  owner: 'sidebar' | 'card',
) {
  if (owner === 'card') await screen.getByRole('listitem').hover()
  await screen.getByRole('button', { name: /common.operation.moreActionsFor/ }).click()
  await screen.getByRole('menuitem', { name: 'app.editApp', exact: true }).click()
  const dialog = screen.getByRole('dialog', { name: 'app.editAppTitle', exact: true })
  await expect.element(dialog).toBeVisible()
  return dialog
}

beforeEach(async () => {
  await page.viewport(1280, 900)
  transport.mockReset()
  push.mockReset()
  replace.mockReset()
  transport.mockImplementation(async (path: readonly string[]) => {
    throw new Error(`Unexpected Console request: ${path.join('.')}`)
  })
})

afterEach(async () => {
  await cleanup()
  for (const client of clients.splice(0)) client.clear()
  vi.unstubAllGlobals()
})

it.each(['sidebar', 'card'] as const)(
  'keeps the real %s edit draft until retry succeeds and restores the menu entry',
  async (owner) => {
    const first = deferred<typeof app>()
    const retry = deferred<typeof app>()
    transport
      .mockImplementationOnce((path: readonly string[]) => {
        expect(path.join('.')).toBe('apps.byAppId.put')
        return first.promise
      })
      .mockImplementationOnce((path: readonly string[]) => {
        expect(path.join('.')).toBe('apps.byAppId.put')
        return retry.promise
      })
    const screen = await renderOwner(owner)
    const trigger = screen.getByRole('button', { name: /common.operation.moreActionsFor/ })
    const dialog = await openEdit(screen, owner)
    const input = dialog.getByRole('textbox', { name: 'app.newApp.captionName' })
    await input.fill('Retained edit')
    const description = dialog.getByRole('textbox', { name: 'app.newApp.captionDescription' })
    await description.fill('Retry description')
    const submit = dialog.getByRole('button', { name: /common.operation.save/ })
    await submit.click()
    await expect.poll(() => transport.mock.calls.length).toBe(1)
    expect(transport.mock.calls[0]?.[1]).toMatchObject({
      params: { app_id: app.id },
      body: { name: 'Retained edit', description: 'Retry description' },
    })
    await expect.element(submit).toHaveFocus()
    await expect.element(input).toHaveAttribute('readonly')
    await userEvent.keyboard('{Enter}{Escape}')
    expect(transport).toHaveBeenCalledTimes(1)
    await expect.element(dialog).toBeVisible()
    await expect
      .element(dialog.getByRole('button', { name: 'common.operation.cancel' }))
      .toBeDisabled()
    await expect
      .element(dialog.getByRole('button', { name: 'common.operation.close' }))
      .toBeDisabled()
    first.reject(new Error('Save unavailable'))
    await expect.element(input).not.toHaveAttribute('readonly')
    await expect.element(input).toHaveValue('Retained edit')
    await expect.element(description).toHaveValue('Retry description')
    await submit.click()
    await expect.poll(() => transport.mock.calls.length).toBe(2)
    retry.resolve({ ...app, name: 'Retained edit', description: 'Retry description' })
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
    expect(trigger.element().checkVisibility({ opacityProperty: true })).toBe(true)
    expect(transport).toHaveBeenCalledTimes(2)
    expect(push).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  },
)

it('isolates IconPicker Mod+Enter and retains the edit draft through exit before reopening fresh', async () => {
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  const screen = await renderOwner('sidebar')
  const trigger = screen.getByRole('button', { name: /common.operation.moreActionsFor/ })
  let dialog = await openEdit(screen, 'sidebar')
  const name = dialog.getByRole('textbox', { name: 'app.newApp.captionName' })
  await name.fill('Discarded edit')
  const iconTrigger = dialog.getByRole('button', { name: 'app.iconPicker.title' })
  await iconTrigger.click()
  const picker = screen.getByRole('dialog', { name: 'app.iconPicker.title' })
  await expect.element(picker).toBeVisible()
  await picker.getByRole('tab', { name: 'app.iconPicker.emoji', exact: true }).click()
  await userEvent.keyboard('{Control>}{Enter}{/Control}')
  await userEvent.keyboard('{Meta>}{Enter}{/Meta}')
  expect(transport).not.toHaveBeenCalled()
  await expect.element(picker).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(picker).not.toBeInTheDocument()
  await expect.element(iconTrigger).toHaveFocus()
  const popup = dialog.element()
  await expect.poll(() => getComputedStyle(popup).opacity).toBe('1')
  const exitDraft = new Promise<string | undefined>((resolve) => {
    const onTransition = (event: Event) => {
      if (event.target !== popup || (event as TransitionEvent).propertyName !== 'opacity') return
      popup.removeEventListener('transitionrun', onTransition)
      resolve(popup.querySelector('input')?.value)
    }
    popup.addEventListener('transitionrun', onTransition)
  })
  await dialog.getByRole('button', { name: 'common.operation.cancel' }).click()
  expect(await exitDraft).toBe('Discarded edit')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  dialog = await openEdit(screen, 'sidebar')
  await expect
    .element(dialog.getByRole('textbox', { name: 'app.newApp.captionName' }))
    .toHaveValue(app.name)
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  expect(transport).not.toHaveBeenCalled()
})

it('retains the template draft after a failed detail request and hands retry to DSL confirmation without reopening on cancel', async () => {
  const catalog: GetExploreAppsResponse = {
    recommended_apps: [
      {
        app_id: 'catalog-app',
        app: {
          id: 'catalog-app',
          name: 'Template app',
          mode: 'chat',
          icon_type: 'emoji',
          icon: '🤖',
          icon_background: '#FFEAD5',
          icon_url: null,
        },
        categories: ['Assistant'],
        description: 'Template description',
        can_trial: false,
        position: 0,
      },
    ],
    categories: ['Assistant'],
  }
  const first = deferred<RecommendedAppDetailResponse>()
  const retry = deferred<RecommendedAppDetailResponse>()
  const importResult = deferred<Import>()
  let detailRequests = 0
  transport.mockImplementation((path: readonly string[]) => {
    switch (path.join('.')) {
      case 'explore.apps.get':
        return Promise.resolve(catalog)
      case 'explore.apps.byAppId.get':
        return ++detailRequests === 1 ? first.promise : retry.promise
      case 'apps.imports.post':
        return importResult.promise
      default:
        throw new Error(`Unexpected Console request: ${path.join('.')}`)
    }
  })
  const onClose = vi.fn()
  const screen = await render(
    <QueryClientTestProvider queryClient={createClient()}>
      <EventEmitterContextProvider>
        <TemplateApps onClose={onClose} />
      </EventEmitterContextProvider>
    </QueryClientTestProvider>,
  )
  const template = screen.getByText('Template app', { exact: true })
  await template.hover()
  await screen.getByRole('button', { name: 'app.newApp.useTemplate Template app' }).click()
  const dialog = screen.getByRole('dialog', { name: /^explore\.appCustomize\.title/ })
  const name = dialog.getByRole('textbox', { name: 'app.newApp.captionName' })
  await name.fill('Retained template')
  const create = dialog.getByRole('button', { name: /common.operation.create/ })
  await create.click()
  await expect.poll(() => detailRequests).toBe(1)
  await expect.element(name).toHaveAttribute('readonly')
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).toBeVisible()
  first.reject(new Error('Template unavailable'))
  await expect.element(name).not.toHaveAttribute('readonly')
  await expect.element(name).toHaveValue('Retained template')
  await create.click()
  await expect.poll(() => detailRequests).toBe(2)
  retry.resolve({
    id: 'catalog-app',
    name: 'Template app',
    mode: 'chat',
    can_trial: false,
    export_data: 'template-dsl',
  })
  await expect
    .poll(
      () => transport.mock.calls.filter(([path]) => path.join('.') === 'apps.imports.post').length,
    )
    .toBe(1)
  importResult.resolve({
    id: 'import-app',
    status: 'pending',
    imported_dsl_version: '9.0.0',
    current_dsl_version: '1.0.0',
  })
  const confirm = screen.getByRole('alertdialog', { name: 'app.newApp.appCreateDSLErrorTitle' })
  await expect.element(confirm).toBeVisible()
  await expect.element(dialog).not.toBeInTheDocument()
  await confirm.getByRole('button', { name: 'app.newApp.Cancel' }).click()
  await expect.element(confirm).not.toBeInTheDocument()
  await expect.element(dialog).not.toBeInTheDocument()
  expect(onClose).not.toHaveBeenCalled()
  expect(
    transport.mock.calls.filter(([path]) => path.join('.') === 'apps.imports.post'),
  ).toHaveLength(1)
})
