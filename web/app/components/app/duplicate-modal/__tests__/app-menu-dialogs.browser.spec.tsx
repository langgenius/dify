import { QueryClient } from '@tanstack/react-query'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { AppInfoView } from '@/app/components/app-sidebar/app-info'
import { AppCard } from '@/app/components/apps/app-card'
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
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push, replace }) }))

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

async function renderOwner(owner: 'sidebar' | 'card') {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  seedAccountProfileQuery(client, { id: 'user-1' })
  seedWorkspacePermissionsQuery(client, ['app.create_and_management'])
  seedSystemFeatures(client, { rbac_enabled: true, webapp_auth: { enabled: false } })
  client.setQueryData(consoleQuery.tags.get.queryKey({ input: { query: { type: 'app' } } }), [])
  return render(
    <QueryClientTestProvider queryClient={client}>
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

async function openCommand(
  screen: Awaited<ReturnType<typeof renderOwner>>,
  command: 'duplicate' | 'switch',
  owner: 'sidebar' | 'card' = 'sidebar',
) {
  if (owner === 'card') await screen.getByRole('listitem').hover()
  await screen.getByRole('button', { name: /common.operation.moreActionsFor/ }).click()
  await screen.getByRole('menuitem', { name: `app.${command}`, exact: true }).click()
  const dialog = screen.getByRole('dialog', {
    name: command === 'duplicate' ? 'app.duplicateTitle' : 'app.switch',
    exact: true,
  })
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

afterEach(() => {
  for (const client of clients.splice(0)) client.clear()
  vi.unstubAllGlobals()
})

it.each(['sidebar', 'card'] as const)(
  'awaits the real %s copy request, retains failed drafts, and closes only after success',
  async (owner) => {
    const first = deferred<typeof app>()
    const retry = deferred<typeof app>()
    transport
      .mockImplementationOnce((path: readonly string[]) => {
        expect(path.join('.')).toBe('apps.byAppId.copy.post')
        return first.promise
      })
      .mockImplementationOnce((path: readonly string[]) => {
        expect(path.join('.')).toBe('apps.byAppId.copy.post')
        return retry.promise
      })
    const screen = await renderOwner(owner)
    const menuTrigger = screen.getByRole('button', { name: /common.operation.moreActionsFor/ })
    let dialog = await openCommand(screen, 'duplicate', owner)
    await dialog.getByRole('textbox').fill('Discarded copy')
    await dialog.getByRole('button', { name: 'common.operation.cancel' }).click()
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(menuTrigger).toHaveFocus()
    expect(menuTrigger.element().checkVisibility({ opacityProperty: true })).toBe(true)

    dialog = await openCommand(screen, 'duplicate', owner)
    const input = dialog.getByRole('textbox')
    await expect.element(input).toHaveValue(app.name)
    await input.fill('Retained copy')
    const submit = dialog.getByRole('button', { name: 'app.duplicate', exact: true })
    await submit.click()
    await expect.poll(() => transport.mock.calls.length).toBe(1)
    expect(transport.mock.calls[0]?.[1]).toMatchObject({
      params: { app_id: app.id },
      body: { name: 'Retained copy' },
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
    first.reject(new Error('Copy unavailable'))
    await expect.element(input).not.toHaveAttribute('readonly')
    await expect.element(input).toHaveValue('Retained copy')
    await expect.element(dialog).toBeVisible()
    expect(push).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
    await submit.click()
    await expect.poll(() => transport.mock.calls.length).toBe(2)
    retry.resolve({ ...app, id: 'copied-app', name: 'Retained copy' })
    await expect.element(dialog).not.toBeInTheDocument()
    await expect
      .poll(() => (owner === 'sidebar' ? replace : push).mock.calls)
      .toEqual([['/app/copied-app/configuration']])
  },
)

it('keeps the sidebar switch draft through exit, reopens fresh, and cancels only its nested deletion confirmation', async () => {
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  const screen = await renderOwner('sidebar')
  const menuTrigger = screen.getByRole('button', { name: /common.operation.moreActionsFor/ })
  let dialog = await openCommand(screen, 'switch')
  const input = dialog.getByRole('textbox', { name: 'app.switchLabel' })
  await input.fill('Discarded conversion')
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
  await dialog.getByRole('button', { name: 'app.newApp.Cancel' }).click()
  expect(await exitDraft).toBe('Discarded conversion')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(menuTrigger).toHaveFocus()
  expect(menuTrigger.element().checkVisibility({ opacityProperty: true })).toBe(true)
  dialog = await openCommand(screen, 'switch')
  await expect.element(dialog.getByRole('textbox')).toHaveValue(`${app.name}(copy)`)
  const remove = dialog.getByRole('checkbox', { name: 'app.removeOriginal' })
  await remove.click()
  const confirmation = screen.getByRole('alertdialog', { name: 'app.deleteAppConfirmTitle' })
  await expect.element(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.element(confirmation).not.toBeInTheDocument()
  await expect.element(remove).not.toBeChecked()
  await expect.element(dialog).toBeVisible()
  await expect.element(remove).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(menuTrigger).toHaveFocus()
  expect(transport).not.toHaveBeenCalled()
})

it('awaits AppCard conversion, keeps a failed draft for retry, and closes on conversion success', async () => {
  const first = deferred<{ new_app_id: string; permission_keys: string[] }>()
  const retry = deferred<{ new_app_id: string; permission_keys: string[] }>()
  transport
    .mockImplementationOnce((path: readonly string[]) => {
      expect(path.join('.')).toBe('apps.byAppId.convertToWorkflow.post')
      return first.promise
    })
    .mockImplementationOnce((path: readonly string[]) => {
      expect(path.join('.')).toBe('apps.byAppId.convertToWorkflow.post')
      return retry.promise
    })
  const screen = await renderOwner('card')
  const dialog = await openCommand(screen, 'switch', 'card')
  const input = dialog.getByRole('textbox', { name: 'app.switchLabel' })
  await input.fill('Converted app')
  const submit = dialog.getByRole('button', { name: 'app.switchStart' })
  await submit.click()
  await expect.poll(() => transport.mock.calls.length).toBe(1)
  expect(transport.mock.calls[0]?.[1]).toMatchObject({
    params: { app_id: app.id },
    body: { name: 'Converted app' },
  })
  await expect.element(submit).toHaveFocus()
  await userEvent.keyboard('{Enter}{Escape}')
  expect(transport).toHaveBeenCalledTimes(1)
  await expect.element(dialog).toBeVisible()
  await expect.element(input).toHaveAttribute('readonly')
  await expect.element(dialog.getByRole('button', { name: 'app.newApp.Cancel' })).toBeDisabled()
  await expect
    .element(dialog.getByRole('button', { name: 'common.operation.close' }))
    .toBeDisabled()
  first.reject(new Error('Conversion unavailable'))
  await expect.element(input).not.toHaveAttribute('readonly')
  await expect.element(input).toHaveValue('Converted app')
  expect(push).not.toHaveBeenCalled()
  await submit.click()
  await expect.poll(() => transport.mock.calls.length).toBe(2)
  retry.resolve({ new_app_id: 'converted-app', permission_keys: [AppACLPermission.ViewLayout] })
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.poll(() => push.mock.calls).toEqual([['/app/converted-app/workflow']])
})
