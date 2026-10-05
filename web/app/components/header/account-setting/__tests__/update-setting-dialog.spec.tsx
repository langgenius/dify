import type { AutoUpdateConfig } from '@/app/components/plugins/reference-setting-modal/auto-update-setting/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import {
  AUTO_UPDATE_MODE,
  AUTO_UPDATE_STRATEGY,
} from '@/app/components/plugins/reference-setting-modal/auto-update-setting/types'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { toast } from '@/app/notifications'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { UpdateSettingDialog } from '../update-setting-dialog'

const { getSettings, saveSettings } = vi.hoisted(() => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
}))

vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  get: getSettings,
  post: saveSettings,
}))

const savedConfig: AutoUpdateConfig = {
  strategy_setting: AUTO_UPDATE_STRATEGY.disabled,
  upgrade_time_of_day: 0,
  upgrade_mode: AUTO_UPDATE_MODE.update_all,
  include_plugins: [],
  exclude_plugins: [],
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function renderSettings(category = PluginCategoryEnum.model) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  })
  client.setQueryData(userProfileQueryOptions().queryKey, {
    profile: {
      id: 'user-1',
      name: 'Test User',
      email: 'test@dify.ai',
      avatar_url: null,
      is_password_set: false,
      timezone: 'UTC',
    },
    meta: { currentVersion: null, currentEnv: null },
  })
  const renderCategory = (currentCategory: PluginCategoryEnum) => (
    <QueryClientProvider client={client}>
      <NuqsTestingAdapter>
        <UpdateSettingDialog key={currentCategory} category={currentCategory} />
      </NuqsTestingAdapter>
    </QueryClientProvider>
  )
  const view = render(renderCategory(category))
  return {
    ...view,
    client,
    changeCategory: (next: PluginCategoryEnum) => view.rerender(renderCategory(next)),
  }
}

const settingsTrigger = () =>
  screen.getByRole('button', { name: /^plugin\.autoUpdate\.autoUpdate / })
const strategy = (value: 'disabled' | 'fixOnly' | 'latest') =>
  screen.getByRole('radio', { name: `plugin.autoUpdate.strategy.${value}.name` })

beforeEach(() => {
  vi.clearAllMocks()
  getSettings.mockImplementation(
    async (_url, { params }: { params: { category: PluginCategoryEnum } }) => ({
      category: params.category,
      auto_upgrade: savedConfig,
    }),
  )
})

it('starts a draft when settings arrive and preserves it across a background refresh', async () => {
  const initialSettings = deferred<{
    category: PluginCategoryEnum
    auto_upgrade: AutoUpdateConfig
  }>()
  getSettings.mockReturnValueOnce(initialSettings.promise)
  const user = userEvent.setup()
  const { client } = renderSettings()
  const trigger = screen.getByRole('button', { name: 'plugin.autoUpdate.autoUpdate' })
  await user.click(trigger)
  expect(screen.getByRole('status')).toHaveTextContent('common.loading')
  expect(screen.queryByRole('button', { name: 'common.operation.save' })).not.toBeInTheDocument()
  initialSettings.resolve({ category: PluginCategoryEnum.model, auto_upgrade: savedConfig })
  await waitFor(() => expect(strategy('disabled')).toBeChecked())
  await user.click(strategy('latest'))
  getSettings.mockResolvedValue({
    category: PluginCategoryEnum.model,
    auto_upgrade: { ...savedConfig, strategy_setting: AUTO_UPDATE_STRATEGY.fixOnly },
  })
  await act(async () => {
    await client.refetchQueries({ predicate: (query) => query.queryKey.includes('autoUpgrade') })
  })
  expect(strategy('latest')).toBeChecked()
  await waitFor(() => expect(trigger).toHaveTextContent('plugin.autoUpdate.strategy.fixOnly.name'))
  await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await user.click(settingsTrigger())
  expect(strategy('fixOnly')).toBeChecked()
})

it('keeps an earlier category rollback separate from the current category session', async () => {
  const pendingSave = deferred<void>()
  saveSettings.mockReturnValue(pendingSave.promise)
  const user = userEvent.setup()
  const { changeCategory } = renderSettings()
  await waitFor(() =>
    expect(settingsTrigger()).toHaveTextContent('plugin.autoUpdate.strategy.disabled.name'),
  )
  await user.click(settingsTrigger())
  await user.click(strategy('latest'))
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() => expect(saveSettings).toHaveBeenCalledOnce())
  expect(saveSettings).toHaveBeenCalledWith('/workspaces/current/plugin/auto-upgrade/change', {
    body: {
      category: PluginCategoryEnum.model,
      auto_upgrade: { ...savedConfig, strategy_setting: AUTO_UPDATE_STRATEGY.latest },
    },
  })
  getSettings.mockImplementation(
    async (_url, { params }: { params: { category: PluginCategoryEnum } }) => ({
      category: params.category,
      auto_upgrade: { ...savedConfig, strategy_setting: AUTO_UPDATE_STRATEGY.fixOnly },
    }),
  )
  changeCategory(PluginCategoryEnum.tool)
  await waitFor(() =>
    expect(settingsTrigger()).toHaveTextContent('plugin.autoUpdate.strategy.fixOnly.name'),
  )
  await user.click(settingsTrigger())
  expect(strategy('fixOnly')).toBeChecked()
  await act(async () => {
    pendingSave.reject(new Error('Save failed'))
  })
  expect(strategy('fixOnly')).toBeChecked()
  await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(settingsTrigger()).toHaveTextContent('plugin.autoUpdate.strategy.fixOnly.name')
  changeCategory(PluginCategoryEnum.model)
  await waitFor(() =>
    expect(settingsTrigger()).toHaveTextContent('plugin.autoUpdate.strategy.disabled.name'),
  )
})

it('reports success after the submitted form has closed', async () => {
  const pendingSave = deferred<void>()
  saveSettings.mockReturnValue(pendingSave.promise)
  const success = vi.spyOn(toast, 'success')
  const user = userEvent.setup()
  renderSettings()
  await waitFor(() => expect(settingsTrigger()).toBeInTheDocument())
  await user.click(settingsTrigger())
  await user.click(strategy('latest'))
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(success).not.toHaveBeenCalled()
  await act(async () => {
    pendingSave.resolve()
  })
  await waitFor(() => expect(success).toHaveBeenCalledWith('common.api.actionSuccess'))
})
