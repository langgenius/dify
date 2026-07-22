import type { ReactElement } from 'react'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useMarketplacePlugins } from '@/app/components/plugins/marketplace/query'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { CollectionType } from '@/app/components/tools/types'
import { useGetLanguage } from '@/context/i18n'
import useTheme from '@/hooks/use-theme'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { Theme } from '@/types/app'
import ToolBrowser from '../tool-browser'
import { createToolProvider } from './factories'

vi.mock('@/context/i18n', () => ({
  useGetLanguage: vi.fn(),
}))

vi.mock('@/hooks/use-theme', () => ({
  default: vi.fn(),
}))

vi.mock('@/app/components/plugins/marketplace/query', () => ({
  useMarketplacePlugins: vi.fn(),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/mcp-tool-availability', () => ({
  useMCPToolAvailability: () => ({
    allowed: true,
  }),
}))

vi.mock('@/utils/var', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/var')>()),
  getMarketplaceUrl: (path = '') => `https://marketplace.test${path}`,
}))

vi.mock('../rag-tool-recommendations', () => ({
  RAGToolRecommendations: ({ onLoadMore }: { onLoadMore: () => void }) => (
    <button type="button" onClick={onLoadMore}>
      Load more RAG tools
    </button>
  ),
}))

const mockUseMarketplacePlugins = vi.mocked(useMarketplacePlugins)
const mockUseGetLanguage = vi.mocked(useGetLanguage)
const mockUseTheme = vi.mocked(useTheme)

const render = (ui: ReactElement, enableMarketplace = false) =>
  renderWithConsoleQuery(ui, { systemFeatures: { enable_marketplace: enableMarketplace } })

const createMarketplacePluginsMock = () =>
  ({ data: undefined }) as ReturnType<typeof useMarketplacePlugins>

describe('ToolBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseGetLanguage.mockReturnValue('en_US')
    mockUseTheme.mockReturnValue({ theme: Theme.light } as ReturnType<typeof useTheme>)
    mockUseMarketplacePlugins.mockReturnValue(createMarketplacePluginsMock())
  })

  it('filters tools by the active tab', async () => {
    const user = userEvent.setup()

    render(
      <ToolBrowser
        searchText=""
        tags={[]}
        onSelect={vi.fn()}
        buildInTools={[
          createToolProvider({
            id: 'provider-built-in',
            label: { en_US: 'Built In Provider', zh_Hans: 'Built In Provider' },
          }),
        ]}
        customTools={[
          createToolProvider({
            id: 'provider-custom',
            type: 'custom',
            label: { en_US: 'Custom Provider', zh_Hans: 'Custom Provider' },
          }),
        ]}
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

  it('shows the selected category empty state and keeps the marketplace footer available', async () => {
    const user = userEvent.setup()

    render(
      <ToolBrowser
        searchText=""
        tags={[]}
        onSelect={vi.fn()}
        buildInTools={[
          createToolProvider({
            id: 'provider-built-in',
            label: { en_US: 'Built In Provider', zh_Hans: 'Built In Provider' },
          }),
        ]}
        customTools={[]}
        workflowTools={[]}
        mcpTools={[]}
      />,
      true,
    )

    const customToolsFilter = screen.getByRole('button', {
      name: 'workflow.tabs.customTool',
    })
    customToolsFilter.focus()
    await user.keyboard('{Enter}')

    expect(customToolsFilter).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('Built In Provider')).not.toBeInTheDocument()
    expect(screen.getByText(/addToolModal\.custom\.title/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /addToolModal\.custom\.tip/ })).toHaveAttribute(
      'href',
      '/integrations/tools/api',
    )

    await user.click(screen.getByRole('button', { name: 'workflow.tabs.workflowTool' }))

    expect(screen.getByText(/addToolModal\.workflow\.title/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /addToolModal\.workflow\.tip/ })).toHaveAttribute(
      'href',
      '/integrations/tools/workflow',
    )
    expect(screen.queryByText(/workflowToolEmpty\.step/)).not.toBeInTheDocument()

    const footer = screen.getByRole('contentinfo')
    expect(within(footer).getAllByRole('link')).toHaveLength(1)
    expect(within(footer).getByRole('link', { name: /findMoreInMarketplace/ })).toBeInTheDocument()
  })

  it('updates the tools list title by the active tab', async () => {
    const user = userEvent.setup()

    render(
      <ToolBrowser
        searchText=""
        tags={[]}
        onSelect={vi.fn()}
        buildInTools={[
          createToolProvider({
            id: 'provider-built-in',
            label: { en_US: 'Built In Provider', zh_Hans: 'Built In Provider' },
          }),
        ]}
        customTools={[
          createToolProvider({
            id: 'provider-custom',
            type: CollectionType.custom,
            label: { en_US: 'Swagger Provider', zh_Hans: 'Swagger Provider' },
          }),
        ]}
        workflowTools={[
          createToolProvider({
            id: 'provider-workflow',
            type: CollectionType.workflow,
            label: { en_US: 'Workflow Provider', zh_Hans: 'Workflow Provider' },
          }),
        ]}
        mcpTools={[
          createToolProvider({
            id: 'provider-mcp',
            type: CollectionType.mcp,
            label: { en_US: 'MCP Provider', zh_Hans: 'MCP Provider' },
          }),
        ]}
      />,
    )

    expect(screen.getByText('tools.allTools')).toBeInTheDocument()

    await user.click(screen.getByText('workflow.tabs.plugin'))
    expect(screen.getByText('tools.allToolPlugins')).toBeInTheDocument()

    await user.click(screen.getByText('workflow.tabs.customTool'))
    expect(screen.getByText('tools.allSwaggerAPIAsTool')).toBeInTheDocument()

    await user.click(screen.getByText('workflow.tabs.workflowTool'))
    expect(screen.getByText('tools.allWorkflowAsTool')).toBeInTheDocument()

    await user.click(screen.getByText('MCP'))
    expect(screen.getByText('tools.allMCP')).toBeInTheDocument()
  })

  it('filters the rendered tools by the search text', () => {
    render(
      <ToolBrowser
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
      <ToolBrowser
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

  it('debounces marketplace requests across search and tag changes', async () => {
    const baseProps = {
      onSelect: vi.fn(),
      buildInTools: [],
      customTools: [],
      workflowTools: [],
      mcpTools: [],
    }
    const { rerender } = render(<ToolBrowser {...baseProps} searchText="" tags={[]} />, true)

    rerender(<ToolBrowser {...baseProps} searchText="w" tags={[]} />)
    rerender(<ToolBrowser {...baseProps} searchText="web" tags={['api']} />)
    rerender(<ToolBrowser {...baseProps} searchText="webhook" tags={['automation']} />)

    expect(
      mockUseMarketplacePlugins.mock.calls
        .map(([params]) => params)
        .filter((params) => params?.query || params?.tags?.length),
    ).toEqual([])
    expect(screen.queryByText('workflow.tabs.noPluginsFound')).not.toBeInTheDocument()

    await waitFor(() => {
      expect(mockUseMarketplacePlugins).toHaveBeenLastCalledWith({
        query: 'webhook',
        tags: ['automation'],
        category: PluginCategoryEnum.tool,
      })
    })

    expect(
      mockUseMarketplacePlugins.mock.calls
        .map(([params]) => params)
        .filter((params) => params?.query || params?.tags?.length),
    ).toEqual([
      {
        query: 'webhook',
        tags: ['automation'],
        category: PluginCategoryEnum.tool,
      },
    ])
  })

  it('returns the next tag value when loading more RAG tools', async () => {
    const user = userEvent.setup()
    const onTagsChange = vi.fn()

    render(
      <ToolBrowser
        searchText=""
        tags={[]}
        onTagsChange={onTagsChange}
        onSelect={vi.fn()}
        buildInTools={[createToolProvider({ id: 'provider-built-in' })]}
        customTools={[]}
        workflowTools={[]}
        mcpTools={[]}
        isInRAGPipeline
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Load more RAG tools' }))

    expect(onTagsChange).toHaveBeenCalledWith(['rag'])
  })
})
