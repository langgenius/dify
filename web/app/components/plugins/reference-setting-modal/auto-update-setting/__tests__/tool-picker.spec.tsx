import type { PluginDetail } from '@/app/components/plugins/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { PluginCategoryEnum, PluginSource } from '@/app/components/plugins/types'
import { createPluginDetail } from '../../../plugin-detail-panel/__tests__/endpoint-fixture'
import ToolPicker from '../tool-picker'

const mockInstalledPluginList = vi.hoisted(() => ({
  data: {
    plugins: [] as PluginDetail[],
  },
  isLoading: false,
}))

vi.mock('@/service/use-plugins', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/use-plugins')>()),
  useInstalledPluginList: () => mockInstalledPluginList,
}))

const createPlugin = (
  pluginId: string,
  source: PluginDetail['source'],
  category: PluginCategoryEnum,
  tags: string[],
): PluginDetail => {
  const plugin = createPluginDetail()
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
    vi.clearAllMocks()
    mockInstalledPluginList.data = {
      plugins: [],
    }
    mockInstalledPluginList.isLoading = false
  })

  it('shows the empty installed-plugin state', () => {
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
      screen.getByText('plugin.autoUpdate.noPluginPlaceholder.noInstalled'),
    ).toBeInTheDocument()
  })

  it('filters by plugin type, tags, and query', async () => {
    const user = userEvent.setup()
    mockInstalledPluginList.data = {
      plugins: [
        createPlugin('tool-search', PluginSource.marketplace, PluginCategoryEnum.tool, ['search']),
        createPlugin('tool-rag', PluginSource.marketplace, PluginCategoryEnum.tool, ['rag']),
        createPlugin('model-agent', PluginSource.marketplace, PluginCategoryEnum.model, ['agent']),
        createPlugin('github-tool', PluginSource.github, PluginCategoryEnum.tool, ['rag']),
      ],
    }

    render(
      <ToolPicker
        trigger={<span>trigger</span>}
        value={[]}
        onChange={vi.fn()}
        isShow
        onShowChange={vi.fn()}
      />,
    )

    expect(screen.getAllByRole('checkbox', { name: /^(tool-|model-|datasource-)/ })).toHaveLength(3)
    expect(screen.queryByText('github-tool')).not.toBeInTheDocument()

    await user.click(screen.getByText('plugin.category.models'))
    expect(screen.getAllByRole('checkbox', { name: /^(tool-|model-|datasource-)/ })).toHaveLength(1)
    expect(screen.getByText('model-agent')).toBeInTheDocument()

    await user.click(screen.getByText('plugin.category.tools'))
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

  it('limits selectable integrations to the provided integration category', () => {
    mockInstalledPluginList.data = {
      plugins: [
        createPlugin('model-openai', PluginSource.marketplace, PluginCategoryEnum.model, ['llm']),
        createPlugin('tool-rag', PluginSource.marketplace, PluginCategoryEnum.tool, ['rag']),
        createPlugin('datasource-notion', PluginSource.marketplace, PluginCategoryEnum.datasource, [
          'docs',
        ]),
      ],
    }

    render(
      <ToolPicker
        trigger={<span>trigger</span>}
        value={[]}
        onChange={vi.fn()}
        isShow
        onShowChange={vi.fn()}
        integrationCategory={PluginCategoryEnum.model}
      />,
    )

    expect(screen.getByText('plugin.category.models')).toBeInTheDocument()
    expect(screen.queryByText('plugin.category.all')).not.toBeInTheDocument()
    expect(screen.queryByText('plugin.category.tools')).not.toBeInTheDocument()
    expect(screen.getAllByRole('checkbox', { name: /^(tool-|model-|datasource-)/ })).toHaveLength(1)
    expect(screen.getByText('model-openai')).toBeInTheDocument()
    expect(screen.queryByText('tool-rag')).not.toBeInTheDocument()
    expect(screen.queryByText('datasource-notion')).not.toBeInTheDocument()
  })
})
