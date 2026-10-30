import type { ReactElement } from 'react'
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CollectionType } from '@/app/components/tools/types'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import ToolBrowser from '../tool-browser'
import { createPlugin, createTool, createToolProvider } from './factories'

const { search } = vi.hoisted(() => ({
  search: vi.fn<typeof import('@/service/marketplace').marketplaceClient.searchAdvanced>(),
}))
vi.mock('@/service/marketplace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/marketplace')>()
  return { ...actual, marketplaceClient: { ...actual.marketplaceClient, searchAdvanced: search } }
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  const { createToolProvider } = await import('./factories')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'rag.pipelines.recommendedPlugins.get': async () => ({
        installed_recommended_plugins: [
          createToolProvider({
            id: 'recommended',
            label: { en_US: 'Recommended RAG', zh_Hans: 'Recommended RAG' },
          }),
        ],
        uninstalled_recommended_plugins: [],
      }),
    }),
  }
})

const render = (ui: ReactElement, enableMarketplace = false) => {
  const view = renderWithConsoleQuery(ui, {
    systemFeatures: { enable_marketplace: enableMarketplace },
  })
  return view
}

const marketplaceTool = createPlugin({
  plugin_id: 'marketplace-tool',
  label: { en_US: 'Marketplace Tool' },
})

describe('ToolBrowser', () => {
  beforeEach(() => {
    search.mockReset().mockResolvedValue({ data: { plugins: [], total: 0 } })
  })
  afterEach(async () => {
    await act(async () => cleanup())
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

  it('filters providers and updates the heading for each category', async () => {
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
            tools: [createTool('workflow-tool', 'Run Workflow')],

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
    expect(screen.getByText('Built In Provider')).toBeInTheDocument()
    expect(screen.queryByText('Swagger Provider')).not.toBeInTheDocument()

    await user.click(screen.getByText('workflow.tabs.customTool'))
    expect(screen.getByText('tools.allSwaggerAPIAsTool')).toBeInTheDocument()
    expect(screen.getByText('Swagger Provider')).toBeInTheDocument()
    expect(screen.queryByText('Built In Provider')).not.toBeInTheDocument()

    await user.click(screen.getByText('workflow.tabs.workflowTool'))
    expect(screen.getByText('tools.allWorkflowAsTool')).toBeInTheDocument()
    expect(screen.getByText('Run Workflow')).toBeInTheDocument()
    expect(screen.queryByText('Built In Provider')).not.toBeInTheDocument()

    await user.click(screen.getByText('MCP'))
    expect(screen.getByText('tools.allMCP')).toBeInTheDocument()
    expect(screen.getByText('MCP Provider')).toBeInTheDocument()
    expect(screen.queryByText('Built In Provider')).not.toBeInTheDocument()
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

  it('shows the empty state and request action when local and marketplace tools do not match', async () => {
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
      true,
    )

    await waitFor(() => {
      expect(screen.getByText('workflow.tabs.noPluginsFound')).toBeInTheDocument()
    })
    expect(screen.getByRole('link', { name: 'workflow.tabs.requestToCommunity' })).toHaveAttribute(
      'href',
      'https://github.com/langgenius/dify-plugins/issues/new?template=plugin_request.yaml',
    )
  })

  it('keeps matching local tools visible while marketplace results are loading', async () => {
    const response = createDeferred<Awaited<ReturnType<typeof search>>>()
    search.mockReturnValueOnce(response.promise)

    render(
      <ToolBrowser
        searchText="local"
        tags={[]}
        onSelect={vi.fn()}
        buildInTools={[
          createToolProvider({
            id: 'provider-local',
            label: { en_US: 'Local Toolkit', zh_Hans: 'Local Toolkit' },
          }),
        ]}
        customTools={[]}
        workflowTools={[]}
        mcpTools={[]}
      />,
      true,
    )

    await waitFor(() =>
      expect(search).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ query: 'local', tags: [], category: 'tool' }),
        }),
        expect.anything(),
      ),
    )
    expect(screen.getByText('Local Toolkit')).toBeInTheDocument()
    expect(screen.queryByText('workflow.tabs.noPluginsFound')).not.toBeInTheDocument()
    await act(async () => response.resolve({ data: { plugins: [marketplaceTool], total: 1 } }))
    expect(await screen.findByText('Marketplace Tool')).toBeInTheDocument()
    expect(screen.getByText('Local Toolkit')).toBeInTheDocument()
  })

  it('excludes an installed marketplace plugin even when its provider does not match the search', async () => {
    const installedPlugin = createPlugin({
      plugin_id: 'installed-search',
      label: { en_US: 'Search Plugin', zh_Hans: 'Search Plugin' },
    })
    search.mockResolvedValue({ data: { plugins: [installedPlugin], total: 1 } })

    render(
      <ToolBrowser
        searchText="search"
        tags={[]}
        onSelect={vi.fn()}
        buildInTools={[
          createToolProvider({
            plugin_id: installedPlugin.plugin_id,
            label: { en_US: 'Web Toolkit', zh_Hans: 'Web Toolkit' },
          }),
        ]}
        customTools={[]}
        workflowTools={[]}
        mcpTools={[]}
      />,
      true,
    )

    expect(await screen.findByText('workflow.tabs.noPluginsFound')).toBeInTheDocument()
    expect(screen.queryByText('Search Plugin')).not.toBeInTheDocument()
    expect(screen.queryByText('Web Toolkit')).not.toBeInTheDocument()
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
    rerender(<ToolBrowser {...baseProps} searchText="web" tags={['search']} />)
    rerender(<ToolBrowser {...baseProps} searchText="webhook" tags={['weather']} />)

    expect(search).not.toHaveBeenCalled()
    expect(screen.queryByText('workflow.tabs.noPluginsFound')).not.toBeInTheDocument()
    await waitFor(() =>
      expect(search).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          body: expect.objectContaining({ query: 'webhook', tags: ['weather'], category: 'tool' }),
        }),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    )
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

    expect(await screen.findByText('Recommended RAG')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))

    expect(onTagsChange).toHaveBeenCalledExactlyOnceWith(['rag'])
  })
})
