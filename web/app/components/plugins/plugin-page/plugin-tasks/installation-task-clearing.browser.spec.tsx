import type { PluginStatus } from '@/app/components/plugins/types'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { PluginSource, TaskStatus } from '@/app/components/plugins/types'
import PluginTasks from './index'

const service = vi.hoisted(() => ({ clear: vi.fn().mockResolvedValue({}), refetch: vi.fn() }))
vi.mock('@/service/use-plugins', () => ({
  usePluginTaskList: () => ({
    pluginTasks: [
      {
        id: 'task-1',
        plugins: [
          {
            plugin_unique_identifier: 'plugin-1',
            plugin_id: 'plugin-1',
            source: PluginSource.marketplace,
            status: TaskStatus.success,
            message: '',
            icon: '',
            labels: { en_US: 'Installed Plugin' } as Record<string, string>,
          } satisfies Omit<PluginStatus, 'taskId'>,
        ],
      },
    ],
    handleRefetch: service.refetch,
  }),
  useMutationClearTaskPlugin: () => ({ mutateAsync: service.clear }),
}))
vi.mock('@/app/components/plugins/install-plugin/install-from-marketplace', () => ({
  default: () => null,
}))
vi.mock('@/app/components/plugins/install-plugin/base/use-get-icon', () => ({
  default: () => ({ getIconUrl: () => '' }),
}))
vi.mock('@/context/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/context/i18n')>()),
  useGetLanguage: () => 'en_US',
}))

it('clears a completed plugin installation task using the keyboard and returns focus to installation status', async () => {
  // Native Tab must include the button that CSS used to hide from keyboard users.
  const screen = await render(<PluginTasks />)
  const trigger = screen.getByRole('button', { name: /plugin.task.installSuccess/ })
  await trigger.click()
  const taskDetails = screen.getByRole('dialog')
  await expect.element(taskDetails).toBeVisible()
  await expect.element(screen.getByRole('menu')).not.toBeInTheDocument()
  const clearAll = screen.getByRole('button', {
    name: 'plugin.task.successPlugins plugin.task.clearAll',
  })
  clearAll.element().focus()
  await userEvent.tab()
  const clear = screen.getByRole('button', { name: 'Clear Installed Plugin' })
  await expect.element(clear).toHaveFocus()
  expect(clear.element().checkVisibility({ checkOpacity: true })).toBe(true)
  await userEvent.keyboard('{Enter}')
  expect(service.clear).toHaveBeenCalledExactlyOnceWith({ taskId: 'task-1', pluginId: 'plugin-1' })
  await expect.element(taskDetails).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
})
