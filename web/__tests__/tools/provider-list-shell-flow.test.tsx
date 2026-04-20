import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProviderList from '@/app/components/tools/provider-list'
import { CollectionType } from '@/app/components/tools/types'
import { renderWithNuqs } from '@/test/nuqs-testing'

const mockInvalidateInstalledPluginList = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => options?.ns ? `${options.ns}.${key}` : key,
  }),
}))

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    systemFeatures: {
      enable_marketplace: true,
    },
  }),
}))

vi.mock('@/app/components/plugins/hooks', () => ({
  useTags: () => ({
    getTagLabel: (name: string) => name,
  }),
}))

vi.mock('@/service/use-tools', () => ({
  useAllToolProviders: () => ({
    data: [
      {
        id: 'builtin-plugin',
        name: 'plugin-tool',
        author: 'Dify',
        description: { en_US: 'Plugin Tool' },
        icon: 'icon-plugin',
        label: { en_US: 'Plugin Tool' },
        type: CollectionType.builtIn,
        team_credentials: {},
        is_team_authorization: false,
        allow_delete: false,
        labels: ['search'],
        plugin_id: 'langgenius/plugin-tool',
      },
      {
        id: 'builtin-basic',
        name: 'basic-tool',
        author: 'Dify',
        description: { en_US: 'Basic Tool' },
        icon: 'icon-basic',
        label: { en_US: 'Basic Tool' },
        type: CollectionType.builtIn,
        team_credentials: {},
        is_team_authorization: false,
        allow_delete: false,
        labels: ['utility'],
      },
    ],
    refetch: vi.fn(),
  }),
}))

vi.mock('@/service/use-plugins', () => ({
  useCheckInstalled: ({ enabled }: { enabled: boolean }) => ({
    data: enabled
      ? {
          plugins: [{
            plugin_id: 'langgenius/plugin-tool',
            declaration: {
              category: 'tool',
            },
          }],
        }
      : null,
  }),
  useInvalidateInstalledPluginList: () => mockInvalidateInstalledPluginList,
}))

vi.mock('@/app/components/tools/labels/filter', () => ({
  default: ({ onChange }: { onChange: (value: string[]) => void }) => (
    <div data-testid="tool-label-filter">
      <button type="button" onClick={() => onChange(['search'])}>apply-search-filter</button>
    </div>
  ),
}))

vi.mock('@/app/components/plugins/card', () => ({
  default: ({ payload, className }: { payload: { name: string }, className?: string }) => (
    <div data-testid={`tool-card-${payload.name}`} className={className}>
      {payload.name}
    </div>
  ),
}))

vi.mock('@/app/components/plugins/card/card-more-info', () => ({
  default: ({ tags }: { tags: string[] }) => <div data-testid="tool-card-more-info">{tags.join(',')}</div>,
}))

vi.mock('@/app/components/tools/provider/detail', () => ({
  default: ({ collection, onHide }: { collection: { name: string }, onHide: () => void }) => (
    <div data-testid="tool-provider-detail">
      <span>{collection.name}</span>
      <button type="button" onClick={onHide}>close-provider-detail</button>
    </div>
  ),
}))

vi.mock('@/app/components/plugins/plugin-detail-panel', () => ({
  default: ({
    detail,
    onHide,
    onUpdate,
  }: {
    detail?: { plugin_id: string }
    onHide: () => void
    onUpdate: () => void
  }) => detail
    ? (
        <div data-testid="tool-plugin-detail-panel">
          <span>{detail.plugin_id}</span>
          <button type="button" onClick={onUpdate}>update-plugin-detail</button>
          <button type="button" onClick={onHide}>close-plugin-detail</button>
        </div>
      )
    : null,
}))

vi.mock('@/app/components/tools/provider/empty', () => ({
  default: () => <div data-testid="workflow-empty">workflow empty</div>,
}))

vi.mock('@/app/components/plugins/marketplace/empty', () => ({
  default: ({ text }: { text: string }) => <div data-testid="tools-empty">{text}</div>,
}))

vi.mock('@/app/components/tools/marketplace', () => ({
  default: ({
    isMarketplaceArrowVisible,
    showMarketplacePanel,
  }: {
    isMarketplaceArrowVisible: boolean
    showMarketplacePanel: () => void
  }) => (
    <button type="button" data-testid="marketplace-arrow" data-visible={String(isMarketplaceArrowVisible)} onClick={showMarketplacePanel}>
      marketplace-arrow
    </button>
  ),
}))

vi.mock('@/app/components/tools/marketplace/hooks', () => ({
  useMarketplace: () => ({
    handleScroll: vi.fn(),
  }),
}))

vi.mock('@/app/components/tools/mcp', () => ({
  default: ({ searchText }: { searchText: string }) => <div data-testid="mcp-list">{searchText}</div>,
}))

const renderProviderList = (searchParams = '') => {
  return renderWithNuqs(<ProviderList />, { searchParams })
}

describe('Tool Provider List Shell Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.scrollTo = vi.fn()
  })

  it('opens a plugin-backed provider detail panel and invalidates installed plugins on update', async () => {
    renderProviderList('?category=builtin')

    fireEvent.click(screen.getByTestId('tool-card-plugin-tool'))

    await waitFor(() => {
      expect(screen.getByTestId('tool-plugin-detail-panel'))!.toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'update-plugin-detail' }))
    expect(mockInvalidateInstalledPluginList).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'close-plugin-detail' }))

    await waitFor(() => {
      expect(screen.queryByTestId('tool-plugin-detail-panel')).not.toBeInTheDocument()
    })
  })

  it('scrolls to the marketplace section and syncs workflow tab selection into the URL', async () => {
    const { onUrlUpdate } = renderProviderList('?category=builtin')

    fireEvent.click(screen.getByTestId('marketplace-arrow'))
    expect(Element.prototype.scrollTo).toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('tab-item-workflow'))

    await waitFor(() => {
      expect(screen.getByTestId('workflow-empty'))!.toBeInTheDocument()
    })

    const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1]![0]
    expect(update.searchParams.get('category')).toBe('workflow')
  })
})
