import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import Tabs from '../tabs'
import { TabsEnum } from '../types'

const {
  mockSetState,
  mockInvalidateBuiltInTools,
  mockToolsState,
} = vi.hoisted(() => ({
  mockSetState: vi.fn(),
  mockInvalidateBuiltInTools: vi.fn(),
  mockToolsState: {
    buildInTools: [{ icon: '/tool.svg', name: 'tool' }] as Array<{ icon: string | Record<string, string>, name: string }> | undefined,
    customTools: [] as Array<{ icon: string | Record<string, string>, name: string }> | undefined,
    workflowTools: [] as Array<{ icon: string | Record<string, string>, name: string }> | undefined,
    mcpTools: [] as Array<{ icon: string | Record<string, string>, name: string }> | undefined,
  },
}))

vi.mock('@/app/components/base/tooltip', () => ({
  default: ({
    children,
    popupContent,
  }: {
    children: React.ReactNode
    popupContent: React.ReactNode
  }) => (
    <div>
      <span>{popupContent}</span>
      {children}
    </div>
  ),
}))

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: (selector: (state: { systemFeatures: { enable_marketplace: boolean } }) => unknown) => selector({
    systemFeatures: { enable_marketplace: true },
  }),
}))

vi.mock('@/service/use-plugins', () => ({
  useFeaturedToolsRecommendations: () => ({
    plugins: [],
    isLoading: false,
  }),
}))

vi.mock('@/service/use-tools', () => ({
  useAllBuiltInTools: () => ({ data: mockToolsState.buildInTools }),
  useAllCustomTools: () => ({ data: mockToolsState.customTools }),
  useAllWorkflowTools: () => ({ data: mockToolsState.workflowTools }),
  useAllMCPTools: () => ({ data: mockToolsState.mcpTools }),
  useInvalidateAllBuiltInTools: () => mockInvalidateBuiltInTools,
}))

vi.mock('@/utils/var', () => ({
  basePath: '/console',
}))

vi.mock('../../store', () => ({
  useWorkflowStore: () => ({
    setState: mockSetState,
  }),
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

vi.mock('../all-tools', () => ({
  default: (props: {
    buildInTools: Array<{ icon: string | Record<string, string> }>
    showFeatured: boolean
    featuredLoading: boolean
    onFeaturedInstallSuccess: () => Promise<void>
  }) => (
    <div>
      tools-content
      {props.buildInTools.map((tool, index) => (
        <span key={index}>
          {typeof tool.icon === 'string' ? tool.icon : 'object-icon'}
        </span>
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
    mockToolsState.buildInTools = [{ icon: '/tool.svg', name: 'tool' }]
    mockToolsState.customTools = []
    mockToolsState.workflowTools = []
    mockToolsState.mcpTools = []
  })

  const baseProps = {
    activeTab: TabsEnum.Start,
    onActiveTabChange: vi.fn(),
    searchText: '',
    tags: [],
    onTagsChange: vi.fn(),
    onSelect: vi.fn(),
    blocks: [],
    tabs: [
      { key: TabsEnum.Start, name: 'Start' },
      { key: TabsEnum.Blocks, name: 'Blocks', disabled: true },
      { key: TabsEnum.Tools, name: 'Tools' },
    ],
    filterElem: <div>filter</div>,
  }

  it('should render start content and disabled tab tooltip text', () => {
    render(<Tabs {...baseProps} />)

    expect(screen.getByText('start-content')).toBeInTheDocument()
    expect(screen.getByText('workflow.tabs.startDisabledTip')).toBeInTheDocument()
  })

  it('should switch tabs through click handlers and render tools content with normalized icons', () => {
    const onActiveTabChange = vi.fn()

    render(
      <Tabs
        {...baseProps}
        activeTab={TabsEnum.Tools}
        onActiveTabChange={onActiveTabChange}
      />,
    )

    fireEvent.click(screen.getByText('Start'))

    expect(onActiveTabChange).toHaveBeenCalledWith(TabsEnum.Start)
    expect(screen.getByText('tools-content')).toBeInTheDocument()
    expect(screen.getByText('/console/tool.svg')).toBeInTheDocument()
    expect(screen.getByText('featured-on')).toBeInTheDocument()
    expect(screen.getByText('featured-idle')).toBeInTheDocument()
  })

  it('should sync normalized tools into workflow store state', () => {
    render(<Tabs {...baseProps} activeTab={TabsEnum.Tools} />)

    expect(mockSetState).toHaveBeenCalled()
  })

  it('should ignore clicks on disabled and already active tabs', async () => {
    const user = userEvent.setup()
    const onActiveTabChange = vi.fn()

    render(
      <Tabs
        {...baseProps}
        activeTab={TabsEnum.Start}
        onActiveTabChange={onActiveTabChange}
      />,
    )

    await user.click(screen.getByText('Start'))
    await user.click(screen.getByText('Blocks'))

    expect(onActiveTabChange).not.toHaveBeenCalled()
  })

  it('should render sources content when the sources tab is active and data sources are provided', () => {
    render(
      <Tabs
        {...baseProps}
        activeTab={TabsEnum.Sources}
        dataSources={[{ name: 'dataset', icon: '/dataset.svg' } as never]}
      />,
    )

    expect(screen.getByText('sources-content')).toBeInTheDocument()
  })

  it('should keep the previous workflow store state when tool references do not change', () => {
    mockToolsState.buildInTools = [{ icon: '/console/already-prefixed.svg', name: 'tool' }]

    render(<Tabs {...baseProps} activeTab={TabsEnum.Tools} />)

    const previousState = {
      buildInTools: mockToolsState.buildInTools,
      customTools: mockToolsState.customTools,
      workflowTools: mockToolsState.workflowTools,
      mcpTools: mockToolsState.mcpTools,
    }
    const updateState = mockSetState.mock.calls[0][0] as (state: typeof previousState) => typeof previousState

    expect(updateState(previousState)).toBe(previousState)
  })

  it('should normalize every tool collection and merge updates into workflow store state', () => {
    mockToolsState.buildInTools = [{ icon: { light: '/tool.svg' }, name: 'tool' }]
    mockToolsState.customTools = [{ icon: '/custom.svg', name: 'custom' }]
    mockToolsState.workflowTools = [{ icon: '/workflow.svg', name: 'workflow' }]
    mockToolsState.mcpTools = [{ icon: '/mcp.svg', name: 'mcp' }]

    render(<Tabs {...baseProps} activeTab={TabsEnum.Tools} />)

    expect(screen.getByText('object-icon')).toBeInTheDocument()

    const updateState = mockSetState.mock.calls[0][0] as (state: {
      buildInTools?: Array<{ icon: string | Record<string, string>, name: string }>
      customTools?: Array<{ icon: string | Record<string, string>, name: string }>
      workflowTools?: Array<{ icon: string | Record<string, string>, name: string }>
      mcpTools?: Array<{ icon: string | Record<string, string>, name: string }>
    }) => {
      buildInTools?: Array<{ icon: string | Record<string, string>, name: string }>
      customTools?: Array<{ icon: string | Record<string, string>, name: string }>
      workflowTools?: Array<{ icon: string | Record<string, string>, name: string }>
      mcpTools?: Array<{ icon: string | Record<string, string>, name: string }>
    }

    expect(updateState({
      buildInTools: [],
      customTools: [],
      workflowTools: [],
      mcpTools: [],
    })).toEqual({
      buildInTools: [{ icon: { light: '/tool.svg' }, name: 'tool' }],
      customTools: [{ icon: '/console/custom.svg', name: 'custom' }],
      workflowTools: [{ icon: '/console/workflow.svg', name: 'workflow' }],
      mcpTools: [{ icon: '/console/mcp.svg', name: 'mcp' }],
    })
  })

  it('should skip normalization when a tool list is undefined', () => {
    mockToolsState.buildInTools = undefined

    render(<Tabs {...baseProps} activeTab={TabsEnum.Tools} />)

    expect(screen.getByText('tools-content')).toBeInTheDocument()
  })

  it('should force start content to render and invalidate built-in tools after featured installs', async () => {
    const user = userEvent.setup()

    render(
      <Tabs
        {...baseProps}
        activeTab={TabsEnum.Tools}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Install featured tool' }))

    expect(screen.getByText('tools-content')).toBeInTheDocument()
    expect(mockInvalidateBuiltInTools).toHaveBeenCalledTimes(1)
  })

  it('should render start content when blocks are hidden but forceShowStartContent is enabled', () => {
    render(
      <Tabs
        {...baseProps}
        activeTab={TabsEnum.Start}
        noBlocks
        forceShowStartContent
      />,
    )

    expect(screen.getByText('start-content')).toBeInTheDocument()
  })
})
