import type { consoleClient } from '@/service/console'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { PluginCategoryEnum, PluginSource } from '@/app/components/plugins/types'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createInstalledPluginFixture } from '@/test/fixtures/plugin'
import ToolPicker from '../tool-picker'

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

const createPlugin = (
  pluginId: string,
  source: PluginSource,
  category: PluginCategoryEnum,
  tags: string[],
) => {
  const plugin = createInstalledPluginFixture({ id: pluginId, plugin_id: pluginId })
  return {
    ...plugin,
    plugin_id: pluginId,
    source,
    declaration: {
      ...plugin.declaration,
      category,
      tags,
      label: { ...plugin.declaration.label, en_US: pluginId },
    },
  }
}

describe('ToolPicker', () => {
  beforeEach(() => {
    installedPlugins.mockReset().mockResolvedValue({ plugins: [], total: 0 })
  })

  it('shows the empty installed-plugin state', async () => {
    render(
      <ToolPicker
        trigger={<button>trigger</button>}
        value={[]}
        onChange={vi.fn()}
        isShow
        onShowChange={vi.fn()}
      />,
    )
    expect(
      await screen.findByText('plugin.autoUpdate.noPluginPlaceholder.noInstalled'),
    ).toBeInTheDocument()
  })

  it('filters by plugin type, tags, and query', async () => {
    const user = userEvent.setup()
    installedPlugins.mockResolvedValue({
      plugins: [
        createPlugin('tool-search', PluginSource.marketplace, PluginCategoryEnum.tool, ['search']),
        createPlugin('tool-rag', PluginSource.marketplace, PluginCategoryEnum.tool, ['rag']),
        createPlugin('model-agent', PluginSource.marketplace, PluginCategoryEnum.model, ['agent']),
        createPlugin('github-tool', PluginSource.github, PluginCategoryEnum.tool, ['rag']),
      ],
      total: 4,
    })

    render(
      <ToolPicker
        trigger={<button type="button">trigger</button>}
        value={[]}
        onChange={vi.fn()}
        isShow
        onShowChange={vi.fn()}
      />,
    )

    expect(
      await screen.findAllByRole('checkbox', { name: /^(tool-|model-|datasource-)/ }),
    ).toHaveLength(3)
    expect(screen.queryByText('github-tool')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'plugin.category.models' }))
    expect(screen.getByRole('button', { name: 'plugin.category.models' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getAllByRole('checkbox', { name: /^(tool-|model-|datasource-)/ })).toHaveLength(1)
    expect(screen.getByText('model-agent')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'plugin.category.tools' }))
    expect(screen.getAllByRole('checkbox', { name: /^(tool-|model-|datasource-)/ })).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: 'pluginTags.allTags' }))
    await user.click(screen.getByRole('checkbox', { name: 'pluginTags.tags.rag' }))
    expect(screen.getAllByRole('checkbox', { name: /^(tool-|model-|datasource-)/ })).toHaveLength(1)
    expect(screen.getByText('tool-rag')).toBeInTheDocument()
    await user.keyboard('{Escape}')

    const search = screen.getByRole('searchbox', { name: 'plugin.searchTools' })
    await user.type(search, 'tool-rag')
    expect(screen.getAllByRole('checkbox', { name: /^(tool-|model-|datasource-)/ })).toHaveLength(1)
    expect(search).toHaveValue('tool-rag')
    await user.clear(search)
    await user.type(search, 'not-installed')
    expect(screen.queryByRole('checkbox', { name: 'tool-rag' })).not.toBeInTheDocument()
    expect(screen.getByText('plugin.autoUpdate.noPluginPlaceholder.noFound')).toBeInTheDocument()
  })

  it('limits selectable integrations to the provided integration category', async () => {
    installedPlugins.mockResolvedValue({
      plugins: [
        createPlugin('model-openai', PluginSource.marketplace, PluginCategoryEnum.model, ['llm']),
        createPlugin('tool-rag', PluginSource.marketplace, PluginCategoryEnum.tool, ['rag']),
        createPlugin('datasource-notion', PluginSource.marketplace, PluginCategoryEnum.datasource, [
          'docs',
        ]),
      ],
      total: 3,
    })

    render(
      <ToolPicker
        trigger={<button type="button">trigger</button>}
        value={[]}
        onChange={vi.fn()}
        isShow
        onShowChange={vi.fn()}
        integrationCategory={PluginCategoryEnum.model}
      />,
    )

    expect(await screen.findByRole('checkbox', { name: 'model-openai' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'plugin.category.models' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.queryByRole('button', { name: 'plugin.category.all' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'plugin.category.tools' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('checkbox', { name: /^(tool-|model-|datasource-)/ })).toHaveLength(1)
    expect(screen.getByText('model-openai')).toBeInTheDocument()
    expect(screen.queryByText('tool-rag')).not.toBeInTheDocument()
    expect(screen.queryByText('datasource-notion')).not.toBeInTheDocument()
  })
})
