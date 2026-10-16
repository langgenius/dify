import type { consoleClient } from '@/service/console'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { MARKETPLACE_API_PREFIX } from '@/config'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createInstalledPluginFixture } from '@/test/fixtures/plugin'
import PluginsPicker from '../plugins-picker'
import { AUTO_UPDATE_MODE } from '../types'

const plugin = (id: string, label: string, category: PluginCategoryEnum) => {
  const entity = createInstalledPluginFixture({ id, plugin_id: id })
  return {
    ...entity,
    plugin_id: id,
    declaration: { ...entity.declaration, category, label: { en_US: label }, tags: [] },
  }
}
const plugins = [
  plugin('dify/model-plugin', 'Model plugin', PluginCategoryEnum.model),
  plugin('dify/tool-plugin', 'Tool plugin', PluginCategoryEnum.tool),
  plugin('dify/new-tool-plugin', 'New tool plugin', PluginCategoryEnum.tool),
  plugin('dify/datasource-plugin', 'Datasource plugin', PluginCategoryEnum.datasource),
]

const installedPlugins = vi.hoisted(() =>
  vi.fn<typeof consoleClient.workspaces.current.plugin.list.get>(),
)

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.plugin.list.get': installedPlugins,
    }),
  }
})

beforeEach(() => {
  installedPlugins.mockReset().mockResolvedValue({ plugins, total: plugins.length })
})

it('opens the installed catalog and updates the selection when a plugin is checked and unchecked', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  function Picker() {
    const [value, setValue] = useState<string[]>([])
    return (
      <PluginsPicker
        updateMode={AUTO_UPDATE_MODE.partial}
        value={value}
        onChange={(next) => {
          setValue(next)
          onChange(next)
        }}
      />
    )
  }
  render(<Picker />)

  expect(screen.getByText('plugin.autoUpdate.upgradeModePlaceholder.partial')).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'plugin.autoUpdate.operation.select' }))
  const dialog = await screen.findByRole('dialog')
  const checkbox = await within(dialog).findByRole('checkbox', { name: 'Tool plugin' })
  expect(
    within(dialog)
      .getAllByRole('presentation')
      .map((image) => image.getAttribute('src')),
  ).toContain(`${MARKETPLACE_API_PREFIX}/plugins/dify/tool-plugin/icon`)
  await user.click(checkbox)
  expect(checkbox).toBeChecked()
  expect(onChange).toHaveBeenCalledExactlyOnceWith(['dify/tool-plugin'])
  await user.click(checkbox)
  expect(checkbox).not.toBeChecked()
  expect(onChange).toHaveBeenLastCalledWith([])
})

it('summarizes excluded plugins and clears all selections without a category scope', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(
    <PluginsPicker
      updateMode={AUTO_UPDATE_MODE.exclude}
      value={['dify/model-plugin', 'dify/tool-plugin']}
      onChange={onChange}
    />,
  )

  expect(
    screen.getByText('plugin.autoUpdate.excludeUpdate:{"count":2,"num":2}'),
  ).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'plugin.autoUpdate.operation.clearAll' }))
  expect(onChange).toHaveBeenCalledExactlyOnceWith([])
})

it('edits only the current category and preserves hidden selections', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(
    <PluginsPicker
      updateMode={AUTO_UPDATE_MODE.exclude}
      value={['dify/model-plugin', 'dify/tool-plugin', 'dify/datasource-plugin']}
      onChange={onChange}
      integrationCategory={PluginCategoryEnum.tool}
    />,
  )

  expect(
    await screen.findByText('plugin.autoUpdate.excludeUpdate:{"count":1,"num":1}'),
  ).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'plugin.autoUpdate.operation.select' }))
  const dialog = within(await screen.findByRole('dialog'))
  expect(dialog.getByRole('checkbox', { name: 'Tool plugin' })).toBeChecked()
  expect(dialog.queryByRole('checkbox', { name: 'Model plugin' })).not.toBeInTheDocument()
  expect(dialog.queryByRole('checkbox', { name: 'Datasource plugin' })).not.toBeInTheDocument()
  await user.click(dialog.getByRole('checkbox', { name: 'New tool plugin' }))
  expect(onChange).toHaveBeenCalledWith([
    'dify/model-plugin',
    'dify/datasource-plugin',
    'dify/tool-plugin',
    'dify/new-tool-plugin',
  ])
  await user.keyboard('{Escape}')
  await user.click(screen.getByRole('button', { name: 'plugin.autoUpdate.operation.clearAll' }))
  expect(onChange).toHaveBeenLastCalledWith(['dify/model-plugin', 'dify/datasource-plugin'])
})
