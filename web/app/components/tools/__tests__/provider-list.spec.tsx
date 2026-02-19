import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolTypeEnum } from '../../workflow/block-selector/types'
import ProviderList from '../provider-list'
import { getToolType } from '../utils'

vi.mock('@/app/components/plugins/hooks', () => ({
  useTags: () => ({
    tags: [],
    tagsMap: {},
    getTagLabel: (name: string) => name,
  }),
}))

let mockEnableMarketplace = false
vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ systemFeatures: { enable_marketplace: mockEnableMarketplace } }),
}))

const createDefaultCollections = () => [
  {
    id: 'builtin-1',
    name: 'google-search',
    author: 'Dify',
    description: { en_US: 'Google Search', zh_Hans: '谷歌搜索' },
    icon: 'icon-google',
    label: { en_US: 'Google Search', zh_Hans: '谷歌搜索' },
    type: 'builtin',
    team_credentials: {},
    is_team_authorization: false,
    allow_delete: false,
    labels: ['search'],
  },
  {
    id: 'builtin-2',
    name: 'weather-tool',
    author: 'Dify',
    description: { en_US: 'Weather Tool', zh_Hans: '天气工具' },
    icon: 'icon-weather',
    label: { en_US: 'Weather Tool', zh_Hans: '天气工具' },
    type: 'builtin',
    team_credentials: {},
    is_team_authorization: false,
    allow_delete: false,
    labels: ['utility'],
  },
  {
    id: 'builtin-plugin',
    name: 'plugin-tool',
    author: 'Dify',
    description: { en_US: 'Plugin Tool', zh_Hans: '插件工具' },
    icon: 'icon-plugin',
    label: { en_US: 'Plugin Tool', zh_Hans: '插件工具' },
    type: 'builtin',
    team_credentials: {},
    is_team_authorization: false,
    allow_delete: false,
    labels: [],
    plugin_id: 'org/plugin-tool',
  },
  {
    id: 'api-1',
    name: 'my-api',
    author: 'User',
    description: { en_US: 'My API tool', zh_Hans: '我的 API 工具' },
    icon: { background: '#fff', content: '🔧' },
    label: { en_US: 'My API Tool', zh_Hans: '我的 API 工具' },
    type: 'api',
    team_credentials: {},
    is_team_authorization: false,
    allow_delete: true,
    labels: [],
  },
  {
    id: 'workflow-1',
    name: 'wf-tool',
    author: 'User',
    description: { en_US: 'Workflow Tool', zh_Hans: '工作流工具' },
    icon: { background: '#fff', content: '⚡' },
    label: { en_US: 'Workflow Tool', zh_Hans: '工作流工具' },
    type: 'workflow',
    team_credentials: {},
    is_team_authorization: false,
    allow_delete: true,
    labels: [],
  },
]

let mockCollectionData: ReturnType<typeof createDefaultCollections> = []
const mockRefetch = vi.fn()
vi.mock('@/service/use-tools', () => ({
  useAllToolProviders: () => ({
    data: mockCollectionData,
    refetch: mockRefetch,
  }),
}))

let mockCheckedInstalledData: { plugins: { id: string, name: string }[] } | null = null
const mockInvalidateInstalledPluginList = vi.fn()
vi.mock('@/service/use-plugins', () => ({
  useCheckInstalled: ({ enabled }: { enabled: boolean }) => ({
    data: enabled ? mockCheckedInstalledData : null,
  }),
  useInvalidateInstalledPluginList: () => mockInvalidateInstalledPluginList,
}))

vi.mock('@/app/components/plugins/card', () => ({
  default: ({ payload, className }: { payload: { name: string }, className?: string }) => (
    <div data-testid={`card-${payload.name}`} className={className}>{payload.name}</div>
  ),
}))

vi.mock('@/app/components/plugins/card/card-more-info', () => ({
  default: ({ tags }: { tags: string[] }) => <div data-testid="card-more-info">{tags.join(', ')}</div>,
}))

vi.mock('@/app/components/tools/labels/filter', () => ({
  default: ({ value, onChange }: { value: string[], onChange: (v: string[]) => void }) => (
    <div data-testid="label-filter">
      <button data-testid="add-filter" onClick={() => onChange(['search'])}>Add filter</button>
      <button data-testid="clear-filter" onClick={() => onChange([])}>Clear filter</button>
      <span>{value.join(', ')}</span>
    </div>
  ),
}))

vi.mock('@/app/components/tools/provider/custom-create-card', () => ({
  default: () => <div data-testid="custom-create-card">Create Custom Tool</div>,
}))

vi.mock('@/app/components/tools/provider/detail', () => ({
  default: ({ collection, onHide }: { collection: { name: string }, onHide: () => void }) => (
    <div data-testid="provider-detail">
      <span>{collection.name}</span>
      <button data-testid="detail-close" onClick={onHide}>Close</button>
    </div>
  ),
}))

vi.mock('@/app/components/tools/provider/empty', () => ({
  default: () => <div data-testid="workflow-empty">No workflow tools</div>,
}))

vi.mock('@/app/components/plugins/plugin-detail-panel', () => ({
  default: ({ detail, onUpdate, onHide }: { detail: unknown, onUpdate: () => void, onHide: () => void }) =>
    detail
      ? (
          <div data-testid="plugin-detail-panel">
            <button data-testid="plugin-update" onClick={onUpdate}>Update</button>
            <button data-testid="plugin-close" onClick={onHide}>Close</button>
          </div>
        )
      : null,
}))

vi.mock('@/app/components/plugins/marketplace/empty', () => ({
  default: ({ text }: { text: string }) => <div data-testid="empty">{text}</div>,
}))

const mockHandleScroll = vi.fn()
vi.mock('../marketplace', () => ({
  default: ({ showMarketplacePanel, isMarketplaceArrowVisible }: {
    showMarketplacePanel: () => void
    isMarketplaceArrowVisible: boolean
  }) => (
    <div data-testid="marketplace">
      <button data-testid="marketplace-arrow" onClick={showMarketplacePanel}>
        {isMarketplaceArrowVisible ? 'arrow-visible' : 'arrow-hidden'}
      </button>
    </div>
  ),
}))

vi.mock('../marketplace/hooks', () => ({
  useMarketplace: () => ({
    isLoading: false,
    marketplaceCollections: [],
    marketplaceCollectionPluginsMap: {},
    plugins: [],
    handleScroll: mockHandleScroll,
    page: 1,
  }),
}))

vi.mock('../mcp', () => ({
  default: ({ searchText }: { searchText: string }) => (
    <div data-testid="mcp-list">
      MCP List:
      {searchText}
    </div>
  ),
}))

describe('getToolType', () => {
  it.each([
    ['builtin', ToolTypeEnum.BuiltIn],
    ['api', ToolTypeEnum.Custom],
    ['workflow', ToolTypeEnum.Workflow],
    ['mcp', ToolTypeEnum.MCP],
    ['unknown', ToolTypeEnum.BuiltIn],
  ])('returns correct ToolTypeEnum for "%s"', (input, expected) => {
    expect(getToolType(input)).toBe(expected)
  })
})

const renderProviderList = (searchParams?: Record<string, string>) => {
  return render(
    <NuqsTestingAdapter searchParams={searchParams}>
      <ProviderList />
    </NuqsTestingAdapter>,
  )
}

describe('ProviderList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnableMarketplace = false
    mockCollectionData = createDefaultCollections()
    mockCheckedInstalledData = null
    Element.prototype.scrollTo = vi.fn()
  })

  afterEach(() => {
    cleanup()
  })

  describe('Tab Navigation', () => {
    it('renders all four tabs', () => {
      renderProviderList()
      expect(screen.getByText('tools.type.builtIn')).toBeInTheDocument()
      expect(screen.getByText('tools.type.custom')).toBeInTheDocument()
      expect(screen.getByText('tools.type.workflow')).toBeInTheDocument()
      expect(screen.getByText('MCP')).toBeInTheDocument()
    })

    it('switches tab when clicked', () => {
      renderProviderList()
      fireEvent.click(screen.getByText('tools.type.custom'))
      expect(screen.getByTestId('custom-create-card')).toBeInTheDocument()
    })

    it('resets current provider when switching to a different tab', () => {
      renderProviderList()
      fireEvent.click(screen.getByTestId('card-google-search'))
      expect(screen.getByTestId('provider-detail')).toBeInTheDocument()
      fireEvent.click(screen.getByText('tools.type.custom'))
      expect(screen.queryByTestId('provider-detail')).not.toBeInTheDocument()
    })

    it('does not reset provider when clicking the already active tab', () => {
      renderProviderList()
      fireEvent.click(screen.getByTestId('card-google-search'))
      expect(screen.getByTestId('provider-detail')).toBeInTheDocument()
      fireEvent.click(screen.getByText('tools.type.builtIn'))
      expect(screen.getByTestId('provider-detail')).toBeInTheDocument()
    })
  })

  describe('Filtering', () => {
    it('shows only builtin collections by default', () => {
      renderProviderList()
      expect(screen.getByTestId('card-google-search')).toBeInTheDocument()
      expect(screen.getByTestId('card-weather-tool')).toBeInTheDocument()
      expect(screen.queryByTestId('card-my-api')).not.toBeInTheDocument()
    })

    it('filters by search keyword', () => {
      renderProviderList()
      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'nonexistent' } })
      expect(screen.queryByTestId('card-google-search')).not.toBeInTheDocument()
    })

    it('filters by search keyword matching label', () => {
      renderProviderList()
      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'Google' } })
      expect(screen.getByTestId('card-google-search')).toBeInTheDocument()
      expect(screen.queryByTestId('card-weather-tool')).not.toBeInTheDocument()
    })

    it('filters collections by tag', () => {
      renderProviderList()
      fireEvent.click(screen.getByTestId('add-filter'))
      expect(screen.getByTestId('card-google-search')).toBeInTheDocument()
      expect(screen.queryByTestId('card-weather-tool')).not.toBeInTheDocument()
      expect(screen.queryByTestId('card-plugin-tool')).not.toBeInTheDocument()
    })

    it('restores all collections when tag filter is cleared', () => {
      renderProviderList()
      fireEvent.click(screen.getByTestId('add-filter'))
      expect(screen.queryByTestId('card-weather-tool')).not.toBeInTheDocument()
      fireEvent.click(screen.getByTestId('clear-filter'))
      expect(screen.getByTestId('card-google-search')).toBeInTheDocument()
      expect(screen.getByTestId('card-weather-tool')).toBeInTheDocument()
    })

    it('clears search with clear button', () => {
      renderProviderList()
      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'Google' } })
      expect(screen.queryByTestId('card-weather-tool')).not.toBeInTheDocument()
      fireEvent.click(screen.getByTestId('input-clear'))
      expect(screen.getByTestId('card-weather-tool')).toBeInTheDocument()
    })

    it('shows label filter for non-MCP tabs', () => {
      renderProviderList()
      expect(screen.getByTestId('label-filter')).toBeInTheDocument()
    })

    it('hides label filter for MCP tab', () => {
      renderProviderList({ category: 'mcp' })
      expect(screen.queryByTestId('label-filter')).not.toBeInTheDocument()
    })

    it('renders search input', () => {
      renderProviderList()
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })
  })

  describe('Custom Tab', () => {
    it('shows custom create card when on api tab', () => {
      renderProviderList({ category: 'api' })
      expect(screen.getByTestId('custom-create-card')).toBeInTheDocument()
    })
  })

  describe('Workflow Tab', () => {
    it('shows workflow collections', () => {
      renderProviderList({ category: 'workflow' })
      expect(screen.getByTestId('card-wf-tool')).toBeInTheDocument()
    })

    it('shows empty state when no workflow collections exist', () => {
      mockCollectionData = createDefaultCollections().filter(c => c.type !== 'workflow')
      renderProviderList({ category: 'workflow' })
      expect(screen.getByTestId('workflow-empty')).toBeInTheDocument()
    })
  })

  describe('Builtin Tab Empty State', () => {
    it('shows empty component when no builtin collections', () => {
      mockCollectionData = createDefaultCollections().filter(c => c.type !== 'builtin')
      renderProviderList()
      expect(screen.getByTestId('empty')).toBeInTheDocument()
    })

    it('renders collection that has no labels property', () => {
      mockCollectionData = [{
        id: 'no-labels',
        name: 'no-label-tool',
        author: 'Dify',
        description: { en_US: 'Tool', zh_Hans: '工具' },
        icon: 'icon',
        label: { en_US: 'No Label Tool', zh_Hans: '无标签工具' },
        type: 'builtin',
        team_credentials: {},
        is_team_authorization: false,
        allow_delete: false,
      }] as unknown as ReturnType<typeof createDefaultCollections>
      renderProviderList()
      expect(screen.getByTestId('card-no-label-tool')).toBeInTheDocument()
    })
  })

  describe('MCP Tab', () => {
    it('renders MCPList component', () => {
      renderProviderList({ category: 'mcp' })
      expect(screen.getByTestId('mcp-list')).toBeInTheDocument()
    })
  })

  describe('Provider Detail', () => {
    it('opens provider detail when a non-plugin collection is clicked', () => {
      renderProviderList()
      fireEvent.click(screen.getByTestId('card-google-search'))
      expect(screen.getByTestId('provider-detail')).toBeInTheDocument()
      expect(screen.getByTestId('provider-detail')).toHaveTextContent('google-search')
    })

    it('closes provider detail when close button is clicked', () => {
      renderProviderList()
      fireEvent.click(screen.getByTestId('card-google-search'))
      expect(screen.getByTestId('provider-detail')).toBeInTheDocument()
      fireEvent.click(screen.getByTestId('detail-close'))
      expect(screen.queryByTestId('provider-detail')).not.toBeInTheDocument()
    })
  })

  describe('Plugin Detail Panel', () => {
    it('shows plugin detail panel when collection with plugin_id is selected', () => {
      mockCheckedInstalledData = {
        plugins: [{ id: 'org/plugin-tool', name: 'Plugin Tool' }],
      }
      renderProviderList()
      expect(screen.queryByTestId('plugin-detail-panel')).not.toBeInTheDocument()
      fireEvent.click(screen.getByTestId('card-plugin-tool'))
      expect(screen.getByTestId('plugin-detail-panel')).toBeInTheDocument()
    })

    it('calls invalidateInstalledPluginList on plugin update', () => {
      mockCheckedInstalledData = {
        plugins: [{ id: 'org/plugin-tool', name: 'Plugin Tool' }],
      }
      renderProviderList()
      fireEvent.click(screen.getByTestId('card-plugin-tool'))
      fireEvent.click(screen.getByTestId('plugin-update'))
      expect(mockInvalidateInstalledPluginList).toHaveBeenCalled()
    })

    it('clears current provider on plugin panel close', () => {
      mockCheckedInstalledData = {
        plugins: [{ id: 'org/plugin-tool', name: 'Plugin Tool' }],
      }
      renderProviderList()
      fireEvent.click(screen.getByTestId('card-plugin-tool'))
      expect(screen.getByTestId('plugin-detail-panel')).toBeInTheDocument()
      fireEvent.click(screen.getByTestId('plugin-close'))
      expect(screen.queryByTestId('plugin-detail-panel')).not.toBeInTheDocument()
    })
  })

  describe('Marketplace', () => {
    it('shows marketplace when enable_marketplace is true and on builtin tab', () => {
      mockEnableMarketplace = true
      renderProviderList()
      expect(screen.getByTestId('marketplace')).toBeInTheDocument()
    })

    it('does not show marketplace when enable_marketplace is false', () => {
      renderProviderList()
      expect(screen.queryByTestId('marketplace')).not.toBeInTheDocument()
    })

    it('scrolls to marketplace panel on arrow click', () => {
      mockEnableMarketplace = true
      renderProviderList()
      fireEvent.click(screen.getByTestId('marketplace-arrow'))
      expect(Element.prototype.scrollTo).toHaveBeenCalled()
    })
  })

  describe('Scroll Handling', () => {
    it('delegates scroll events to marketplace handleScroll', () => {
      mockEnableMarketplace = true
      const { container } = renderProviderList()
      const scrollContainer = container.querySelector('.overflow-y-auto') as HTMLDivElement
      fireEvent.scroll(scrollContainer)
      expect(mockHandleScroll).toHaveBeenCalled()
    })

    it('updates marketplace arrow visibility on scroll', () => {
      mockEnableMarketplace = true
      renderProviderList()
      expect(screen.getByTestId('marketplace-arrow')).toHaveTextContent('arrow-visible')
      const scrollContainer = document.querySelector('.overflow-y-auto') as HTMLDivElement
      fireEvent.scroll(scrollContainer)
      expect(screen.getByTestId('marketplace-arrow')).toHaveTextContent('arrow-hidden')
    })
  })
})
