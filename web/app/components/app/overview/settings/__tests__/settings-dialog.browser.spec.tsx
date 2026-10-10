import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import { QueryClient, useQuery } from '@tanstack/react-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { useAccessPointActions } from '@/app/components/app/access-point/shared/use-access-point-actions'
import { emojiCatalogOptions } from '@/app/components/base/icon-picker/emoji-data'
import { consoleQuery } from '@/service/console'
import { seedFeatures, seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createAppDetailFixture, createAppSiteFixture } from '@/test/fixtures/app'
import { SettingsDialog } from '../index'

const { saveSite, fetchApp, notify } = vi.hoisted(() => ({
  saveSite: vi.fn(),
  fetchApp: vi.fn(),
  notify: vi.fn(),
}))

vi.mock('@/app/notifications', () => ({
  toast: Object.assign(notify, { success: notify, error: notify, warning: notify, info: notify }),
}))
vi.mock('@/next/navigation', () => ({ useParams: () => ({}) }))

const settingsTitle = 'appOverview.overview.appInfo.settings.title'
const titleLabel = 'appOverview.overview.appInfo.settings.webName'
const triggerLabel = 'navigation.settings.settings'
const appQuery = consoleQuery.apps.byAppId.get.queryOptions({
  input: { params: { app_id: 'settings-app' } },
})

function createApp(title = 'Original app'): AppDetailWithSite {
  return createAppDetailFixture({
    id: 'settings-app',
    mode: 'advanced-chat',
    site: createAppSiteFixture({
      title,
      description: 'Original description',
      icon_type: 'emoji',
      icon: '😀',
      icon_background: '#FEF3F2',
      default_language: 'en-US',
    }),
  })
}

function SettingsOwner() {
  const { data: appInfo } = useQuery(appQuery)
  const { saveSiteConfig } = useAccessPointActions('settings-app', true)
  return (
    <SettingsDialog
      isChat
      appInfo={
        appInfo?.site ? { id: appInfo.id, mode: appInfo.mode, site: appInfo.site } : undefined
      }
      onSave={saveSiteConfig}
    />
  )
}

async function renderSettings() {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  })
  client.setQueryData(appQuery.queryKey, createApp())
  seedSystemFeatures(client, { deployment_edition: 'COMMUNITY' })
  seedFeatures(client, { webapp_copyright_enabled: true })
  client.setQueryData(emojiCatalogOptions.queryKey, [
    {
      id: 'faces',
      label: 'Faces',
      items: [{ emoji: '😎', label: 'Cool face', version: 1 }],
    },
  ])
  const screen = await render(
    <QueryClientTestProvider queryClient={client}>
      <NuqsTestingAdapter>
        <SettingsOwner />
      </NuqsTestingAdapter>
    </QueryClientTestProvider>,
  )
  return { screen, client }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const appId = /\/apps\/([^/]+)/.exec(new URL(request.url).pathname)?.[1]
    if (request.method === 'GET')
      return Response.json(await fetchApp({ params: { app_id: appId } }))
    return Response.json(
      await saveSite({
        params: { app_id: appId },
        body: await request.json(),
      }),
    )
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

it('retains a failed save draft and closes a successful retry before the background refresh finishes', async () => {
  let rejectSave!: (error: Error) => void
  saveSite.mockReturnValueOnce(
    new Promise((_, reject) => {
      rejectSave = reject
    }),
  )
  saveSite.mockResolvedValueOnce({})
  let finishRefresh!: (value: AppDetailWithSite) => void
  fetchApp.mockReturnValueOnce(
    new Promise<AppDetailWithSite>((resolve) => {
      finishRefresh = resolve
    }),
  )
  const { screen, client } = await renderSettings()
  const trigger = screen.getByRole('button', { name: triggerLabel })
  await trigger.click()
  const dialog = screen.getByRole('dialog', { name: settingsTitle })
  const title = dialog.getByRole('textbox', { name: titleLabel })
  await title.fill('Saved after retry')
  const save = dialog.getByRole('button', { name: 'common.operation.save' })
  await save.click()
  await expect.element(save).toHaveFocus()
  await expect.element(save).toHaveAttribute('aria-disabled', 'true')
  await expect.element(title).toHaveAttribute('readonly')
  await expect
    .element(dialog.getByRole('button', { name: 'common.operation.close' }))
    .toBeDisabled()
  await expect
    .element(dialog.getByRole('button', { name: 'common.operation.cancel' }))
    .toBeDisabled()
  await userEvent.keyboard('{Enter}{Escape}')
  await expect.element(dialog).toBeVisible()
  expect(saveSite).toHaveBeenCalledTimes(1)
  expect(fetchApp).not.toHaveBeenCalled()
  rejectSave(new Error('Save failed'))
  await expect.element(save).not.toHaveAttribute('aria-disabled', 'true')
  await expect.element(title).not.toHaveAttribute('readonly')
  await expect.element(title).toHaveValue('Saved after retry')
  await expect.element(dialog).toBeVisible()

  await save.click()
  await expect.poll(() => fetchApp.mock.calls.length).toBe(1)
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  expect(saveSite).toHaveBeenCalledTimes(2)
  expect(client.getQueryData(appQuery.queryKey)?.site?.title).toBe('Original app')
  const refreshed = createApp('Saved after retry')
  finishRefresh(refreshed)
  await expect.poll(() => client.getQueryData(appQuery.queryKey)).toEqual(refreshed)
  await trigger.click()
  await expect.element(title).toHaveValue('Saved after retry')
  await dialog.getByRole('button', { name: 'common.operation.close' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  expect(saveSite).toHaveBeenLastCalledWith({
    params: { app_id: 'settings-app' },
    body: expect.objectContaining({ title: 'Saved after retry' }),
  })
  client.clear()
})

it('closes after a successful POST even when the background detail refresh fails', async () => {
  saveSite.mockResolvedValueOnce({})
  fetchApp.mockRejectedValueOnce(new Error('Refresh failed'))
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  const { screen, client } = await renderSettings()
  const trigger = screen.getByRole('button', { name: triggerLabel })
  await trigger.click()
  const dialog = screen.getByRole('dialog', { name: settingsTitle })
  await dialog.getByRole('textbox', { name: titleLabel }).fill('Saved remotely')
  await dialog.getByRole('button', { name: 'common.operation.save' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  await expect.poll(() => fetchApp.mock.calls.length).toBe(1)
  expect(notify).toHaveBeenCalledExactlyOnceWith('common.actionMsg.modifiedSuccessfully', {
    type: 'success',
  })
  expect(saveSite).toHaveBeenCalledTimes(1)
  client.clear()
  consoleError.mockRestore()
})

it('keeps the draft through the exit animation and reopens with the latest owner metadata', async () => {
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  const { screen, client } = await renderSettings()
  const trigger = screen.getByRole('button', { name: triggerLabel })
  await userEvent.tab()
  await expect.element(trigger).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  const dialog = screen.getByRole('dialog', { name: settingsTitle })
  const title = dialog.getByRole('textbox', { name: titleLabel })
  await title.fill('Cancelled draft')
  const popup = dialog.element()
  const input = title.element() as HTMLInputElement
  await expect.poll(() => getComputedStyle(popup).opacity).toBe('1')
  const exitFrame = new Promise<{ value: string; opacity: number }>((resolve) => {
    const onTransition = (event: Event) => {
      if (event.target !== popup || (event as TransitionEvent).propertyName !== 'opacity') return
      popup.removeEventListener('transitionrun', onTransition)
      resolve({ value: input.value, opacity: Number(getComputedStyle(popup).opacity) })
    }
    popup.addEventListener('transitionrun', onTransition)
  })
  await dialog.getByRole('button', { name: 'common.operation.cancel' }).click()
  const closing = await exitFrame
  expect(closing.value).toBe('Cancelled draft')
  expect(closing.opacity).toBeGreaterThan(0)
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  client.setQueryData(appQuery.queryKey, createApp('Fresh metadata'))
  await userEvent.keyboard(' ')
  await expect.element(title).toHaveValue('Fresh metadata')
  await title.fill('Another local draft')
  client.setQueryData(appQuery.queryKey, createApp('Changed while open'))
  await expect.element(title).toHaveValue('Changed while open')
  await expect
    .poll(() => {
      const close = dialog.getByRole('button', { name: 'common.operation.close' }).element()
      return document.activeElement === title.element() || document.activeElement === close
        ? 'settings control'
        : document.activeElement?.tagName
    })
    .toBe('settings control')
  await dialog.getByRole('button', { name: 'common.operation.close' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  expect(saveSite).not.toHaveBeenCalled()
  client.clear()
})

it('keeps icon search and confirmation inside the nested picker without submitting Settings', async () => {
  const { screen, client } = await renderSettings()
  await screen.getByRole('button', { name: triggerLabel }).click()
  const settings = screen.getByRole('dialog', { name: settingsTitle })
  const title = settings.getByRole('textbox', { name: titleLabel })
  await title.fill('Keep this draft')
  const iconTrigger = settings.getByRole('button', { name: 'app.iconPicker.title' })
  await iconTrigger.click()
  const picker = screen.getByRole('dialog', { name: 'app.iconPicker.title' })
  await picker.getByRole('combobox', { name: 'app.iconPicker.search' }).fill('Cool')
  await userEvent.keyboard('{ArrowDown}{Enter}')
  expect(saveSite).not.toHaveBeenCalled()
  await picker.getByRole('button', { name: 'app.iconPicker.ok' }).click()
  await expect.element(picker).not.toBeInTheDocument()
  await expect.element(settings).toBeVisible()
  await expect.element(iconTrigger).toHaveFocus()
  await expect.element(title).toHaveValue('Keep this draft')
  expect(saveSite).not.toHaveBeenCalled()
  await userEvent.keyboard('{Enter}')
  await expect.element(picker).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(picker).not.toBeInTheDocument()
  await expect.element(settings).toBeVisible()
  await expect.element(iconTrigger).toHaveFocus()
  expect(saveSite).not.toHaveBeenCalled()
  client.clear()
})
