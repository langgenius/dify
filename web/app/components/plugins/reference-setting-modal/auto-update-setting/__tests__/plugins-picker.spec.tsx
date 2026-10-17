import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { createPluginEntity } from '@/test/fixtures/plugin'
import PluginsPicker from '../plugins-picker'
import { AUTO_UPDATE_MODE } from '../types'

const plugin = (id: string, label: string, category: PluginCategoryEnum) => {
  const entity = createPluginEntity()
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

vi.mock('@/service/use-plugins', () => ({
  useInstalledPluginList: () => ({ data: { plugins }, isLoading: false }),
}))

it('opens the picker from the empty state and selects an installed plugin', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<PluginsPicker updateMode={AUTO_UPDATE_MODE.partial} value={[]} onChange={onChange} />)

  expect(screen.getByText('plugin.autoUpdate.upgradeModePlaceholder.partial')).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'plugin.autoUpdate.operation.select' }))
  const dialog = await screen.findByRole('dialog')
  await user.click(within(dialog).getByRole('checkbox', { name: 'Tool plugin' }))
  expect(onChange).toHaveBeenCalledExactlyOnceWith(['dify/tool-plugin'])
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
    screen.getByText('plugin.autoUpdate.excludeUpdate:{"count":1,"num":1}'),
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
