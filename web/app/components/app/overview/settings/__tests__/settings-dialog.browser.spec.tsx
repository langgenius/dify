import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import { QueryClient, useQuery } from '@tanstack/react-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { seedFeatures, seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createAppDetailFixture, createAppSiteFixture } from '@/test/fixtures/app'
import { SettingsDialog } from '../index'

const saveSite = vi.fn()

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
  return (
    <SettingsDialog
      isChat
      appInfo={
        appInfo?.site ? { id: appInfo.id, mode: appInfo.mode, site: appInfo.site } : undefined
      }
      onSave={saveSite}
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
  const screen = await render(
    <QueryClientTestProvider queryClient={client}>
      <NuqsTestingAdapter>
        <SettingsOwner />
      </NuqsTestingAdapter>
    </QueryClientTestProvider>,
  )
  return { screen, client }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

it('keeps the draft through the exit animation', async () => {
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
  expect(saveSite).not.toHaveBeenCalled()
  client.clear()
})
