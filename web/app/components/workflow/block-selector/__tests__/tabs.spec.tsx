import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { consoleQuery } from '@/service/console'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createToolProviderFixture } from '@/test/console/tool-provider-fixture'
import { createTestWorkflowStore } from '../../__tests__/workflow-test-env'
import { WorkflowContext } from '../../context'
import { BlockSelectorPanels } from '../tabs'
import { TabType } from '../types'

const render = (ui: React.ReactElement) =>
  renderWithConsoleQuery(
    <WorkflowContext.Provider value={createTestWorkflowStore()}>{ui}</WorkflowContext.Provider>,
    { systemFeatures: { enable_marketplace: true } },
  )

const { mockToolsState } = vi.hoisted(() => ({
  mockToolsState: {
    buildInTools: [{ icon: '/tool.svg', name: 'tool' }] as
      | Array<{ icon: string | Record<string, string>; name: string }>
      | undefined,
    customTools: [] as Array<{ icon: string | Record<string, string>; name: string }> | undefined,
    workflowTools: [] as Array<{ icon: string | Record<string, string>; name: string }> | undefined,
    mcpTools: [] as Array<{ icon: string | Record<string, string>; name: string }> | undefined,
  },
}))

vi.mock('@/service/use-plugins', () => ({
  useFeaturedToolsRecommendations: () => ({
    plugins: [],
    isLoading: false,
  }),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.tools.builtin.get': async () => mockToolsState.buildInTools,
      'workspaces.current.tools.api.get': async () => mockToolsState.customTools,
      'workspaces.current.tools.workflow.get': async () => mockToolsState.workflowTools,
      'workspaces.current.tools.mcp.get': async () => mockToolsState.mcpTools,
    }),
  }
})

vi.mock('@/utils/var', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/var')>()),
  basePath: '/console',
}))

vi.mock('../all-start-blocks', () => ({
  default: () => <div>start-content</div>,
}))

vi.mock('../blocks', () => ({
  default: () => <div>blocks-content</div>,
}))

vi.mock('../data-sources', () => ({
  default: () => <div>sources-content</div>,
}))

vi.mock('../tool-browser', () => ({
  default: (props: {
    buildInTools: Array<{ icon: string | Record<string, string>; name: string }>
    showFeatured: boolean
    featuredLoading: boolean
    onFeaturedInstallSuccess: () => Promise<void>
  }) => (
    <div>
      tools-content
      {props.buildInTools.map((tool) => (
        <span key={tool.name}>{typeof tool.icon === 'string' ? tool.icon : 'object-icon'}</span>
      ))}
      <span>{props.showFeatured ? 'featured-on' : 'featured-off'}</span>
      <span>{props.featuredLoading ? 'featured-loading' : 'featured-idle'}</span>
      <button onClick={() => props.onFeaturedInstallSuccess()}>Install featured tool</button>
    </div>
  ),
}))

describe('Tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockToolsState.buildInTools = [createToolProviderFixture({ icon: '/tool.svg', name: 'tool' })]
    mockToolsState.customTools = []
    mockToolsState.workflowTools = []
    mockToolsState.mcpTools = []
  })

  const baseProps = {
    defaultTab: TabType.Start,
    searchInputRef: React.createRef<HTMLInputElement>(),
    onSelect: vi.fn(),
    onRequestClose: vi.fn(),
    blocks: [],
    tabs: [
      { key: TabType.Start, name: 'Start' },
      { key: TabType.Blocks, name: 'Blocks', disabled: true },
      { key: TabType.Tools, name: 'Tools' },
    ],
  }

  it('should render start content and disabled tab tooltip text', async () => {
    const user = userEvent.setup()
    render(<BlockSelectorPanels {...baseProps} />)

    expect(screen.getByText('start-content'))!.toBeInTheDocument()
    await user.hover(screen.getByRole('tab', { name: 'Blocks' }))
    expect(await screen.findByText('workflow.tabs.startDisabledTip'))!.toBeInTheDocument()
  })

  it('should expose tab semantics and use manual keyboard activation', async () => {
    const user = userEvent.setup()
    render(<BlockSelectorPanels {...baseProps} />)

    const startTab = screen.getByRole('tab', { name: 'Start' })
    const blocksTab = screen.getByRole('tab', { name: 'Blocks' })
    const toolsTab = screen.getByRole('tab', { name: 'Tools' })

    expect(screen.getByRole('tablist', { name: 'workflow.common.addBlock' })).toBeInTheDocument()
    expect(startTab).toHaveAttribute('aria-selected', 'true')
    expect(blocksTab).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('tabpanel', { name: 'Start' })).toBeInTheDocument()

    await user.click(startTab)
    await user.keyboard('{ArrowRight}')
    expect(blocksTab).toHaveFocus()
    expect(startTab).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowRight}')
    expect(toolsTab).toHaveFocus()
    expect(startTab).toHaveAttribute('aria-selected', 'true')
  })

  it('should ignore clicks on disabled and already active tabs', async () => {
    const user = userEvent.setup()
    render(<BlockSelectorPanels {...baseProps} />)

    const startTab = screen.getByRole('tab', { name: 'Start' })
    await user.click(startTab)
    await user.click(screen.getByRole('tab', { name: 'Blocks' }))

    expect(startTab).toHaveAttribute('aria-selected', 'true')
  })

  it('should fall back to an available tab when the active tab is removed', async () => {
    const user = userEvent.setup()

    function Harness() {
      const [tabs, setTabs] = React.useState(baseProps.tabs)

      return (
        <>
          <button
            type="button"
            onClick={() =>
              setTabs((currentTabs) => currentTabs.filter((tab) => tab.key !== TabType.Tools))
            }
          >
            Remove tools
          </button>
          <BlockSelectorPanels {...baseProps} tabs={tabs} />
        </>
      )
    }

    render(<Harness />)

    await user.click(screen.getByRole('tab', { name: 'Tools' }))
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Tools' })).toHaveAttribute('aria-selected', 'true')
    })

    await user.click(screen.getByRole('button', { name: 'Remove tools' }))

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Start' })).toHaveAttribute('aria-selected', 'true')
    })
  })

  it('should render sources content when the sources tab is active and data sources are provided', () => {
    render(
      <BlockSelectorPanels
        {...baseProps}
        defaultTab={TabType.Sources}
        tabs={[...baseProps.tabs, { key: TabType.Sources, name: 'Sources' }]}
        dataSources={[{ name: 'dataset', icon: '/dataset.svg' } as never]}
      />,
    )

    expect(screen.getByText('sources-content'))!.toBeInTheDocument()
  })

  it('keeps search state independent for each tab during the popup session', async () => {
    const user = userEvent.setup()
    render(
      <BlockSelectorPanels
        {...baseProps}
        defaultTab={TabType.Blocks}
        tabs={[
          { key: TabType.Blocks, name: 'Blocks' },
          { key: TabType.Tools, name: 'Tools' },
        ]}
      />,
    )

    const blocksSearch = screen.getByRole('searchbox', { name: 'workflow.tabs.searchBlock' })
    await user.type(blocksSearch, 'llm')
    await user.click(screen.getByRole('tab', { name: 'Tools' }))

    const toolsSearch = screen.getByRole('searchbox', { name: 'plugin.searchTools' })
    expect(toolsSearch).toHaveValue('')
    await user.type(toolsSearch, 'slack')
    await user.click(screen.getByRole('tab', { name: 'Blocks' }))

    expect(screen.getByRole('searchbox', { name: 'workflow.tabs.searchBlock' })).toHaveValue('llm')
    await user.click(screen.getByRole('tab', { name: 'Tools' }))
    expect(screen.getByRole('searchbox', { name: 'plugin.searchTools' })).toHaveValue('slack')
  })

  it('should force start content to render and invalidate built-in tools after featured installs', async () => {
    const user = userEvent.setup()

    const { queryClient } = render(
      <BlockSelectorPanels {...baseProps} defaultTab={TabType.Tools} />,
    )
    const builtInToolsKey = consoleQuery.workspaces.current.tools.builtin.get.queryKey()
    queryClient.setQueryData(builtInToolsKey, [])

    mockToolsState.buildInTools = [
      createToolProviderFixture({ name: 'installed-tool', icon: '/installed-tool.svg' }),
    ]
    await user.click(screen.getByRole('button', { name: 'Install featured tool' }))

    expect(screen.getByText('tools-content'))!.toBeInTheDocument()
    expect(await screen.findByText('/console/installed-tool.svg')).toBeInTheDocument()
    expect(queryClient.getQueryData(builtInToolsKey)).toEqual(mockToolsState.buildInTools)
  })

  it('should compose start content directly without tab semantics in standalone mode', () => {
    render(<BlockSelectorPanels {...baseProps} standalonePanel={TabType.Start} />)

    expect(screen.getByText('start-content'))!.toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })
})
