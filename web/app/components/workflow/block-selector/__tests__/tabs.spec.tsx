import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import Tabs from '../tabs'
import { TabsEnum } from '../types'

const {
  mockSetState,
  mockInvalidateBuiltInTools,
} = vi.hoisted(() => ({
  mockSetState: vi.fn(),
  mockInvalidateBuiltInTools: vi.fn(),
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
  useAllBuiltInTools: () => ({ data: [{ icon: '/tool.svg', name: 'tool' }] }),
  useAllCustomTools: () => ({ data: [] }),
  useAllWorkflowTools: () => ({ data: [] }),
  useAllMCPTools: () => ({ data: [] }),
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
  default: (props: { buildInTools: Array<{ icon: string }> }) => (
    <div>
      tools-content
      <span>{props.buildInTools[0]?.icon}</span>
    </div>
  ),
}))

describe('Tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
  })

  it('should sync normalized tools into workflow store state', () => {
    render(<Tabs {...baseProps} activeTab={TabsEnum.Tools} />)

    expect(mockSetState).toHaveBeenCalled()
  })
})
