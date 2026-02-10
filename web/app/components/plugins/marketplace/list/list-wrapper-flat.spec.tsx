import type { Template } from '../types'
import type { Plugin } from '@/app/components/plugins/types'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ListWrapper from './list-wrapper'

const { mockMarketplaceData } = vi.hoisted(() => ({
  mockMarketplaceData: {
    creationType: 'plugins' as 'plugins' | 'templates',
    isLoading: false,
    page: 1,
    isFetchingNextPage: false,
    pluginCollections: [],
    pluginCollectionPluginsMap: {},
    plugins: undefined as Plugin[] | undefined,
    templateCollections: [],
    templateCollectionTemplatesMap: {},
    templates: undefined as Template[] | undefined,
  },
}))

vi.mock('../state', () => ({
  useMarketplaceData: () => mockMarketplaceData,
}))

vi.mock('@/app/components/base/loading', () => ({
  default: () => <div data-testid="loading-component">Loading</div>,
}))

vi.mock('./flat-list', () => ({
  default: ({ variant, items }: { variant: 'plugins' | 'templates', items: unknown[] }) => (
    <div data-testid={`flat-list-${variant}`}>
      {items.length}
    </div>
  ),
}))

vi.mock('./list-with-collection', () => ({
  default: ({ variant }: { variant: 'plugins' | 'templates' }) => (
    <div data-testid={`collection-list-${variant}`}>collection</div>
  ),
}))

describe('ListWrapper flat rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMarketplaceData.creationType = 'plugins'
    mockMarketplaceData.isLoading = false
    mockMarketplaceData.page = 1
    mockMarketplaceData.isFetchingNextPage = false
    mockMarketplaceData.plugins = undefined
    mockMarketplaceData.templates = undefined
  })

  it('renders plugin flat list when plugin items exist', () => {
    mockMarketplaceData.creationType = 'plugins'
    mockMarketplaceData.plugins = [{ org: 'o', name: 'p' } as Plugin]

    render(<ListWrapper />)

    expect(screen.getByTestId('flat-list-plugins')).toBeInTheDocument()
    expect(screen.queryByTestId('collection-list-plugins')).not.toBeInTheDocument()
  })

  it('renders template flat list when template items exist', () => {
    mockMarketplaceData.creationType = 'templates'
    mockMarketplaceData.templates = [{ id: 't1' } as Template]

    render(<ListWrapper />)

    expect(screen.getByTestId('flat-list-templates')).toBeInTheDocument()
    expect(screen.queryByTestId('collection-list-templates')).not.toBeInTheDocument()
  })

  it('renders template collection list when templates are undefined', () => {
    mockMarketplaceData.creationType = 'templates'
    mockMarketplaceData.templates = undefined

    render(<ListWrapper />)

    expect(screen.getByTestId('collection-list-templates')).toBeInTheDocument()
    expect(screen.queryByTestId('flat-list-templates')).not.toBeInTheDocument()
  })
})
