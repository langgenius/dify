import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useMarketplacePlugins } from '@/app/components/plugins/marketplace/hooks'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useGetLanguage } from '@/context/i18n'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'
import AllTools from '../all-tools'
import { createGlobalPublicStoreState, createToolProvider } from './factories'

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: vi.fn(),
}))

vi.mock('@/context/i18n', () => ({
  useGetLanguage: vi.fn(),
}))

vi.mock('@/hooks/use-theme', () => ({
  default: vi.fn(),
}))

vi.mock('@/app/components/plugins/marketplace/hooks', () => ({
  useMarketplacePlugins: vi.fn(),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/mcp-tool-availability', () => ({
  useMCPToolAvailability: () => ({
    allowed: true,
  }),
}))

vi.mock('@/utils/var', async importOriginal => ({
  ...(await importOriginal<typeof import('@/utils/var')>()),
  getMarketplaceUrl: () => 'https://marketplace.test/tools',
}))

const mockUseMarketplacePlugins = vi.mocked(useMarketplacePlugins)
const mockUseGlobalPublicStore = vi.mocked(useGlobalPublicStore)
const mockUseGetLanguage = vi.mocked(useGetLanguage)
const mockUseTheme = vi.mocked(useTheme)

const createMarketplacePluginsMock = () => ({
  plugins: [],
  total: 0,
  resetPlugins: vi.fn(),
  queryPlugins: vi.fn(),
  queryPluginsWithDebounced: vi.fn(),
  cancelQueryPluginsWithDebounced: vi.fn(),
  isLoading: false,
  isFetchingNextPage: false,
  hasNextPage: false,
  fetchNextPage: vi.fn(),
  page: 0,
})

describe('AllTools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseGlobalPublicStore.mockImplementation(selector => selector(createGlobalPublicStoreState(false)))
    mockUseGetLanguage.mockReturnValue('en_US')
    mockUseTheme.mockReturnValue({ theme: Theme.light } as ReturnType<typeof useTheme>)
    mockUseMarketplacePlugins.mockReturnValue(createMarketplacePluginsMock())
  })

  it('filters tools by the active tab', async () => {
    const user = userEvent.setup()

    render(
      <AllTools
        searchText=""
        tags={[]}
        onSelect={vi.fn()}
        buildInTools={[createToolProvider({
          id: 'provider-built-in',
          label: { en_US: 'Built In Provider', zh_Hans: 'Built In Provider' },
        })]}
        customTools={[createToolProvider({
          id: 'provider-custom',
          type: 'custom',
          label: { en_US: 'Custom Provider', zh_Hans: 'Custom Provider' },
        })]}
        workflowTools={[]}
        mcpTools={[]}
      />,
    )

    expect(screen.getByText('Built In Provider')).toBeInTheDocument()
    expect(screen.getByText('Custom Provider')).toBeInTheDocument()

    await user.click(screen.getByText('workflow.tabs.customTool'))

    expect(screen.getByText('Custom Provider')).toBeInTheDocument()
    expect(screen.queryByText('Built In Provider')).not.toBeInTheDocument()
  })

  it('filters the rendered tools by the search text', () => {
    render(
      <AllTools
        searchText="report"
        tags={[]}
        onSelect={vi.fn()}
        buildInTools={[
          createToolProvider({
            id: 'provider-report',
            label: { en_US: 'Report Toolkit', zh_Hans: 'Report Toolkit' },
          }),
          createToolProvider({
            id: 'provider-other',
            label: { en_US: 'Other Toolkit', zh_Hans: 'Other Toolkit' },
          }),
        ]}
        customTools={[]}
        workflowTools={[]}
        mcpTools={[]}
      />,
    )

    expect(screen.getByText('Report Toolkit')).toBeInTheDocument()
    expect(screen.queryByText('Other Toolkit')).not.toBeInTheDocument()
  })

  it('shows the empty state when no tool matches the current filter', async () => {
    render(
      <AllTools
        searchText="missing"
        tags={[]}
        onSelect={vi.fn()}
        buildInTools={[]}
        customTools={[]}
        workflowTools={[]}
        mcpTools={[]}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('workflow.tabs.noPluginsFound')).toBeInTheDocument()
    })
  })
})
