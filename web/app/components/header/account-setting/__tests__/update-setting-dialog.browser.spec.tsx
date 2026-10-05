import type { AutoUpdateConfig } from '@/app/components/plugins/reference-setting-modal/auto-update-setting/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import {
  AUTO_UPDATE_MODE,
  AUTO_UPDATE_STRATEGY,
} from '@/app/components/plugins/reference-setting-modal/auto-update-setting/types'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { UpdateSettingDialog } from '../update-setting-dialog'

const { getSettings, saveSettings } = vi.hoisted(() => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
}))

vi.mock('@/service/base', () => ({
  get: getSettings,
  post: saveSettings,
  request: vi.fn(),
  getPublic: vi.fn(),
  getMarketplace: vi.fn(),
  postPublic: vi.fn(),
  postMarketplace: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  delPublic: vi.fn(),
  patch: vi.fn(),
  patchPublic: vi.fn(),
  upload: vi.fn(),
  ssePost: vi.fn(),
  sseGet: vi.fn(),
  sseGeneratorPost: vi.fn(),
  handleStream: vi.fn(),
  buildSigninUrlWithRedirect: vi.fn(),
  isWebAppSigninPath: vi.fn(),
  buildWebAppSigninUrlWithRedirect: vi.fn(),
}))

const savedConfig: AutoUpdateConfig = {
  strategy_setting: AUTO_UPDATE_STRATEGY.disabled,
  upgrade_time_of_day: 0,
  upgrade_mode: AUTO_UPDATE_MODE.update_all,
  include_plugins: [],
  exclude_plugins: [],
}

async function renderSettings() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
  queryClient.setQueryData(userProfileQueryOptions().queryKey, {
    profile: {
      id: 'user-1',
      name: 'Test User',
      email: 'test@dify.ai',
      avatar: '',
      avatar_url: null,
      is_password_set: false,
      timezone: 'UTC',
    },
    meta: { currentVersion: null, currentEnv: null },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <NuqsTestingAdapter>
        <UpdateSettingDialog category={PluginCategoryEnum.model} />
      </NuqsTestingAdapter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  getSettings.mockImplementation(async (url: string) => {
    if (url !== '/workspaces/current/plugin/auto-upgrade/fetch')
      throw new Error(`Unexpected request: ${url}`)
    return { category: PluginCategoryEnum.model, auto_upgrade: savedConfig }
  })
})

afterEach(() => vi.unstubAllGlobals())

it('discards cancelled and escaped drafts without changing the trigger badge and restores focus', async () => {
  const screen = await renderSettings()
  const trigger = screen.getByRole('button', { name: /^plugin\.autoUpdate\.autoUpdate / })
  await expect
    .element(trigger)
    .toHaveTextContent('plugin.autoUpdate.autoUpdateplugin.autoUpdate.strategy.disabled.name')
  const triggerElement = trigger.element()
  const dialog = screen.getByRole('dialog', { name: 'plugin.autoUpdate.autoUpdateSettings' })

  for (const dismissal of ['Cancel', 'Escape']) {
    await trigger.click()
    await expect
      .element(screen.getByRole('radio', { name: 'plugin.autoUpdate.strategy.disabled.name' }))
      .toBeChecked()
    await screen.getByRole('radio', { name: 'plugin.autoUpdate.strategy.latest.name' }).click()
    await expect
      .element(triggerElement)
      .toHaveTextContent('plugin.autoUpdate.autoUpdateplugin.autoUpdate.strategy.disabled.name')
    await expect
      .element(triggerElement)
      .not.toHaveTextContent('plugin.autoUpdate.autoUpdateplugin.autoUpdate.strategy.latest.name')
    if (dismissal === 'Cancel')
      await screen.getByRole('button', { name: 'common.operation.cancel' }).click()
    else await userEvent.keyboard('{Escape}')
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
  }
  await trigger.click()
  await expect
    .element(screen.getByRole('radio', { name: 'plugin.autoUpdate.strategy.disabled.name' }))
    .toBeChecked()
  expect(saveSettings).not.toHaveBeenCalled()
})

it('closes an optimistic save immediately, blocks another pending save and restores rolled-back settings on reopening', async () => {
  let rejectSave!: (error: Error) => void
  saveSettings.mockReturnValue(
    new Promise((_, reject) => {
      rejectSave = reject
    }),
  )
  const screen = await renderSettings()
  const trigger = screen.getByRole('button', { name: /^plugin\.autoUpdate\.autoUpdate / })
  await expect
    .element(trigger)
    .toHaveTextContent('plugin.autoUpdate.autoUpdateplugin.autoUpdate.strategy.disabled.name')
  const triggerElement = trigger.element()
  const dialog = screen.getByRole('dialog', { name: 'plugin.autoUpdate.autoUpdateSettings' })
  await trigger.click()
  await screen.getByRole('radio', { name: 'plugin.autoUpdate.strategy.latest.name' }).click()
  await screen.getByRole('button', { name: 'common.operation.save' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  await expect
    .element(trigger)
    .toHaveTextContent('plugin.autoUpdate.autoUpdateplugin.autoUpdate.strategy.latest.name')
  await expect.poll(() => saveSettings.mock.calls.length).toBe(1)
  expect(saveSettings).toHaveBeenCalledWith('/workspaces/current/plugin/auto-upgrade/change', {
    body: {
      category: PluginCategoryEnum.model,
      auto_upgrade: { ...savedConfig, strategy_setting: AUTO_UPDATE_STRATEGY.latest },
    },
  })

  await trigger.click()
  const save = screen.getByRole('button', { name: 'common.operation.save' })
  await expect.element(save).toHaveAttribute('aria-disabled', 'true')
  await userEvent.tab({ shift: true })
  await expect.element(save).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  expect(saveSettings).toHaveBeenCalledOnce()
  await expect.element(dialog).toBeVisible()

  rejectSave(new Error('Save failed'))
  await expect
    .element(triggerElement)
    .toHaveTextContent('plugin.autoUpdate.autoUpdateplugin.autoUpdate.strategy.disabled.name')
  await expect.element(save).not.toHaveAttribute('aria-disabled', 'true')
  await expect
    .element(screen.getByRole('radio', { name: 'plugin.autoUpdate.strategy.latest.name' }))
    .toBeChecked()
  await screen.getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await trigger.click()
  await expect
    .element(screen.getByRole('radio', { name: 'plugin.autoUpdate.strategy.disabled.name' }))
    .toBeChecked()
  await userEvent.keyboard('{Escape}')
  await expect.element(trigger).toHaveFocus()
})
