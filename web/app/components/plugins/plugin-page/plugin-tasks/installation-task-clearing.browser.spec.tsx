import type { PluginStatus } from '@/app/components/plugins/types'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { PluginSource, TaskStatus } from '@/app/components/plugins/types'
import plugin from '@/i18n/locales/en-US/plugin.json'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import PluginTasks from './index'

const service = vi.hoisted(() => ({ clear: vi.fn().mockResolvedValue({}), refetch: vi.fn() }))
// boundary: task polling and clear mutations stop at the plugin service hooks.
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
            labels: { en_US: 'Installed Plugin' },
          } satisfies Omit<PluginStatus, 'taskId'>,
        ],
      },
    ],
    handleRefetch: service.refetch,
  }),
  useMutationClearTaskPlugin: () => ({ mutateAsync: service.clear }),
}))

vi.unmock('react-i18next')

it('clears a completed plugin installation task using the keyboard and returns focus to installation status', async () => {
  // Native Tab must include the button that CSS used to hide from keyboard users.
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    keySeparator: false,
    resources: { 'en-US': { plugin } },
  })
  onTestFinished(guardUnexpectedFetch())
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper()
  const screen = await render(
    <ConsoleProvider>
      <I18nextProvider i18n={i18n}>
        <PluginTasks />
      </I18nextProvider>
    </ConsoleProvider>,
  )
  const trigger = screen.getByRole('button', { name: '1 integrations installed successfully' })
  await trigger.click()
  const taskDetails = screen.getByRole('dialog')
  await expect.element(taskDetails).toBeVisible()
  await expect.element(screen.getByRole('menu')).not.toBeInTheDocument()
  const clearAll = screen.getByRole('button', {
    name: 'Successfully Installed Integrations Clear all',
  })
  clearAll.element().focus()
  await userEvent.tab()
  const clear = screen.getByRole('button', { name: 'Clear Installed Plugin' })
  await expect.element(clear).toHaveFocus()
  await expect.poll(() => clear.element().checkVisibility({ checkOpacity: true })).toBe(true)
  await userEvent.keyboard('{Enter}')
  expect(service.clear).toHaveBeenCalledExactlyOnceWith({ taskId: 'task-1', pluginId: 'plugin-1' })
  await expect.element(taskDetails).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
})
