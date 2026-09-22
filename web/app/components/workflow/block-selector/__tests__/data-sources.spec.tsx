import type { RagPipelineDatasourceProviderResponse } from '@dify/contracts/api/console/rag/types.gen'
import type { ReactElement } from 'react'
import type { useMarketplacePlugins } from '@/app/components/plugins/marketplace/query'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createDatasourceProvider } from '@/app/components/rag-pipeline/__tests__/datasource-fixtures'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { BlockEnum } from '../../types'
import { DEFAULT_FILE_EXTENSIONS_IN_LOCAL_FILE_DATA_SOURCE } from '../constants'
import DataSources from '../data-sources'

const { marketplaceQuery, language, trackEvent } = vi.hoisted(() => ({
  marketplaceQuery: vi.fn((_params?: Parameters<typeof useMarketplacePlugins>[0]) => ({
    data: undefined,
  })),
  language: { value: 'en_US' },
  trackEvent: vi.fn(),
}))
vi.mock('@/app/components/plugins/marketplace/query', () => ({
  useMarketplacePlugins: marketplaceQuery,
}))
vi.mock('@/context/i18n', () => ({ useGetLanguage: () => language.value }))
vi.mock('@/app/components/base/amplitude', () => ({ trackEvent }))

const render = (ui: ReactElement, enableMarketplace = false) =>
  renderWithConsoleQuery(ui, { systemFeatures: { enable_marketplace: enableMarketplace } })

const namedProvider = (name: string): RagPipelineDatasourceProviderResponse => {
  const provider = createDatasourceProvider()
  return {
    ...provider,
    provider: name,
    plugin_id: `dify/${name}`,
    declaration: {
      ...provider.declaration,
      identity: { ...provider.declaration.identity, label: { en_US: name } },
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  language.value = 'en_US'
})

it('selects the built-in local file datasource directly with its file extensions and canonical provider identity', async () => {
  const user = userEvent.setup()
  const onSelect = vi.fn()
  const provider = createDatasourceProvider()
  render(<DataSources searchText="" onSelect={onSelect} dataSources={[provider]} />)

  await user.click(screen.getByRole('button', { name: 'File Source' }))
  const action = screen.getByRole('button', { name: 'Local File' })
  expect(action).toHaveAccessibleDescription('Load local files')
  action.focus()
  await user.keyboard('{Enter}')

  expect(onSelect).toHaveBeenCalledWith(BlockEnum.DataSource, {
    plugin_id: 'langgenius/file',
    provider_type: 'local_file',
    provider_name: 'file',
    datasource_name: 'local-file',
    datasource_label: 'Local File',
    title: 'Local File',
    plugin_unique_identifier: 'langgenius/file:1.0.0',
    fileExtensions: DEFAULT_FILE_EXTENSIONS_IN_LOCAL_FILE_DATA_SOURCE,
  })
  expect(trackEvent).toHaveBeenCalledWith('tool_selected', {
    tool_name: 'local-file',
    plugin_id: 'langgenius/file',
  })
  expect(provider.declaration.identity.name).toBe('langgenius/file/file')
  expect(screen.queryByRole('button', { name: 'workflow.tabs.addAll' })).not.toBeInTheDocument()
})

it('keeps unauthorized installed providers selectable and falls back from null locale text', async () => {
  language.value = 'zh_Hans'
  const user = userEvent.setup()
  const provider = namedProvider('drive')
  provider.is_authorized = false
  provider.declaration.provider_type = 'online_drive'
  provider.declaration.identity.label = { en_US: 'Drive source', zh_Hans: null }
  provider.declaration.datasources = [
    {
      identity: {
        author: 'Dify',
        name: 'drive-pages',
        provider: 'dify/drive/drive',
        label: { en_US: 'Drive pages', zh_Hans: null },
      },
      description: { en_US: 'Browse pages', zh_Hans: null },
    },
  ]
  const onSelect = vi.fn()
  render(<DataSources searchText="pages" onSelect={onSelect} dataSources={[provider]} />)

  expect(screen.getByRole('button', { name: 'Drive source' })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await user.click(screen.getByRole('button', { name: 'Drive pages' }))

  expect(onSelect).toHaveBeenCalledWith(BlockEnum.DataSource, {
    plugin_id: 'dify/drive',
    provider_type: 'online_drive',
    provider_name: 'drive',
    datasource_name: 'drive-pages',
    datasource_label: 'Drive pages',
    title: 'Drive pages',
    plugin_unique_identifier: provider.plugin_unique_identifier,
  })
})

it('filters by raw provider or action name and retains each matching provider group', async () => {
  const provider = namedProvider('searchable-provider')
  provider.declaration.datasources = [
    {
      identity: {
        author: 'Dify',
        name: 'match-action',
        provider: 'compound',
        label: { en_US: 'Matched action' },
      },
      description: { en_US: 'Matched description' },
    },
    {
      identity: {
        author: 'Dify',
        name: 'sibling',
        provider: 'compound',
        label: { en_US: 'Sibling action' },
      },
      description: { en_US: '' },
    },
  ]
  const { rerender } = render(
    <DataSources
      searchText="MATCH-action"
      onSelect={vi.fn()}
      dataSources={[provider, namedProvider('other')]}
    />,
  )
  expect(screen.getByRole('button', { name: 'Matched action' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Sibling action' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'other' })).not.toBeInTheDocument()

  rerender(
    <DataSources searchText="searchable-provider" onSelect={vi.fn()} dataSources={[provider]} />,
  )
  expect(screen.getByRole('button', { name: 'Matched action' })).toBeInTheDocument()
  rerender(<DataSources searchText="" onSelect={vi.fn()} dataSources={[provider]} />)
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Matched action' })).not.toBeInTheDocument(),
  )
  expect(screen.getByRole('button', { name: 'searchable-provider' })).toHaveAttribute(
    'aria-expanded',
    'false',
  )
})

it('keeps flat letter navigation sorted with pinyin initials and nonalphabetic providers last', () => {
  const providers = [
    '1Source',
    '中文',
    'Alpha',
    'Echo',
    'Foxtrot',
    'Gamma',
    'Hotel',
    'India',
    'Juliet',
    'Kilo',
    'Lima',
  ].map(namedProvider)
  render(<DataSources searchText="" onSelect={vi.fn()} dataSources={providers} />)
  const letters = screen
    .getAllByRole('button')
    .filter((button) => /^[A-Z#]$/.test(button.textContent ?? ''))
  expect(letters.map((button) => button.textContent)).toEqual([
    'A',
    'E',
    'F',
    'G',
    'H',
    'I',
    'J',
    'K',
    'L',
    'Z',
    '#',
  ])
  expect(providers[0]?.provider).toBe('1Source')
})

it('debounces marketplace search while datasource filtering remains immediate', async () => {
  const provider = createDatasourceProvider()
  const onSelect = vi.fn()
  const { rerender } = render(
    <DataSources searchText="" onSelect={onSelect} dataSources={[provider]} />,
    true,
  )

  rerender(<DataSources searchText="i" onSelect={onSelect} dataSources={[provider]} />)
  rerender(<DataSources searchText="in" onSelect={onSelect} dataSources={[provider]} />)
  rerender(<DataSources searchText="invoice" onSelect={onSelect} dataSources={[provider]} />)
  expect(screen.queryByRole('button', { name: 'File Source' })).not.toBeInTheDocument()
  expect(marketplaceQuery.mock.calls.map(([params]) => params).filter(Boolean)).toEqual([])
  await waitFor(() =>
    expect(marketplaceQuery).toHaveBeenLastCalledWith({ query: 'invoice', category: 'datasource' }),
  )
})

it('keeps an expanded datasource open when the language changes its sort letter', async () => {
  const user = userEvent.setup()
  const provider = createDatasourceProvider()
  const { rerender } = render(
    <DataSources searchText="" onSelect={vi.fn()} dataSources={[provider]} />,
  )
  await user.click(screen.getByRole('button', { name: 'File Source' }))
  expect(screen.getByRole('button', { name: 'Local File' })).toBeInTheDocument()

  language.value = 'zh_Hans'
  rerender(<DataSources searchText="" onSelect={vi.fn()} dataSources={[provider]} />)

  expect(screen.getByRole('button', { name: '文件源' })).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('button', { name: '本地文件' })).toBeInTheDocument()
})
