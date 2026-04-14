import type { PluginDetail } from '@/app/components/plugins/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginSource } from '@/app/components/plugins/types'
import ToolPicker from '../tool-picker'

let portalOpen = false

const mockInstalledPluginList = vi.hoisted(() => ({
  data: {
    plugins: [] as PluginDetail[],
  },
  isLoading: false,
}))

vi.mock('@/service/use-plugins', () => ({
  useInstalledPluginList: () => mockInstalledPluginList,
}))

vi.mock('@/app/components/base/loading', () => ({
  default: () => <div data-testid="loading">loading</div>,
}))

vi.mock('@/app/components/base/portal-to-follow-elem', async () => {
  const React = await import('react')
  return {
    PortalToFollowElem: ({
      open,
      children,
    }: {
      open: boolean
      children: React.ReactNode
    }) => {
      portalOpen = open
      return <div>{children}</div>
    },
    PortalToFollowElemTrigger: ({
      children,
      onClick,
    }: {
      children: React.ReactNode
      onClick: () => void
    }) => <button data-testid="trigger" onClick={onClick}>{children}</button>,
    PortalToFollowElemContent: ({
      children,
      className,
    }: {
      children: React.ReactNode
      className?: string
    }) => portalOpen ? <div data-testid="portal-content" className={className}>{children}</div> : null,
  }
})

vi.mock('@/app/components/plugins/marketplace/search-box', () => ({
  default: ({
    search,
    tags,
    onSearchChange,
    onTagsChange,
    placeholder,
  }: {
    search: string
    tags: string[]
    onSearchChange: (value: string) => void
    onTagsChange: (value: string[]) => void
    placeholder: string
  }) => (
    <div data-testid="search-box">
      <div>{placeholder}</div>
      <div data-testid="search-state">{search}</div>
      <div data-testid="tags-state">{tags.join(',')}</div>
      <button data-testid="set-query" onClick={() => onSearchChange('tool-rag')}>set-query</button>
      <button data-testid="set-tags" onClick={() => onTagsChange(['rag'])}>set-tags</button>
    </div>
  ),
}))

vi.mock('../no-data-placeholder', () => ({
  default: ({
    noPlugins,
  }: {
    noPlugins?: boolean
  }) => <div data-testid="no-data">{String(noPlugins)}</div>,
}))

vi.mock('../tool-item', () => ({
  default: ({
    payload,
    isChecked,
    onCheckChange,
  }: {
    payload: PluginDetail
    isChecked?: boolean
    onCheckChange: () => void
  }) => (
    <div data-testid="tool-item">
      <span>{payload.plugin_id}</span>
      <span>{String(isChecked)}</span>
      <button data-testid={`toggle-${payload.plugin_id}`} onClick={onCheckChange}>toggle</button>
    </div>
  ),
}))

const createPlugin = (
  pluginId: string,
  source: PluginDetail['source'],
  category: string,
  tags: string[],
): PluginDetail => ({
  plugin_id: pluginId,
  source,
  declaration: {
    category,
    tags,
  },
} as PluginDetail)

describe('ToolPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    portalOpen = false
    mockInstalledPluginList.data = {
      plugins: [],
    }
    mockInstalledPluginList.isLoading = false
  })

  it('toggles popup visibility from the trigger', () => {
    const onShowChange = vi.fn()
    render(
      <ToolPicker
        trigger={<span>trigger</span>}
        value={[]}
        onChange={vi.fn()}
        isShow={false}
        onShowChange={onShowChange}
      />,
    )

    fireEvent.click(screen.getByTestId('trigger'))

    expect(onShowChange).toHaveBeenCalledWith(true)
  })

  it('renders loading content while installed plugins are loading', () => {
    mockInstalledPluginList.isLoading = true

    render(
      <ToolPicker
        trigger={<span>trigger</span>}
        value={[]}
        onChange={vi.fn()}
        isShow
        onShowChange={vi.fn()}
      />,
    )

    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('renders no-data placeholder when there are no matching marketplace plugins', () => {
    render(
      <ToolPicker
        trigger={<span>trigger</span>}
        value={[]}
        onChange={vi.fn()}
        isShow
        onShowChange={vi.fn()}
      />,
    )

    expect(screen.getByTestId('no-data')).toHaveTextContent('true')
  })

  it('filters by plugin type, tags, and query', () => {
    mockInstalledPluginList.data = {
      plugins: [
        createPlugin('tool-search', PluginSource.marketplace, 'tool', ['search']),
        createPlugin('tool-rag', PluginSource.marketplace, 'tool', ['rag']),
        createPlugin('model-agent', PluginSource.marketplace, 'model', ['agent']),
        createPlugin('github-tool', PluginSource.github, 'tool', ['rag']),
      ],
    }

    render(
      <ToolPicker
        trigger={<span>trigger</span>}
        value={[]}
        onChange={vi.fn()}
        isShow
        onShowChange={vi.fn()}
      />,
    )

    expect(screen.getAllByTestId('tool-item')).toHaveLength(3)
    expect(screen.queryByText('github-tool')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('plugin.category.models'))
    expect(screen.getAllByTestId('tool-item')).toHaveLength(1)
    expect(screen.getByText('model-agent')).toBeInTheDocument()

    fireEvent.click(screen.getByText('plugin.category.tools'))
    expect(screen.getAllByTestId('tool-item')).toHaveLength(2)

    fireEvent.click(screen.getByTestId('set-tags'))
    expect(screen.getAllByTestId('tool-item')).toHaveLength(1)
    expect(screen.getByText('tool-rag')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('set-query'))
    expect(screen.getAllByTestId('tool-item')).toHaveLength(1)
    expect(screen.getByTestId('search-state')).toHaveTextContent('tool-rag')
  })

  it('adds and removes plugin ids from the selection', () => {
    mockInstalledPluginList.data = {
      plugins: [
        createPlugin('tool-rag', PluginSource.marketplace, 'tool', ['rag']),
        createPlugin('tool-search', PluginSource.marketplace, 'tool', ['search']),
      ],
    }
    const onChange = vi.fn()
    const { rerender } = render(
      <ToolPicker
        trigger={<span>trigger</span>}
        value={['tool-rag']}
        onChange={onChange}
        isShow
        onShowChange={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByTestId('toggle-tool-search'))
    expect(onChange).toHaveBeenCalledWith(['tool-rag', 'tool-search'])

    rerender(
      <ToolPicker
        trigger={<span>trigger</span>}
        value={['tool-rag']}
        onChange={onChange}
        isShow
        onShowChange={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByTestId('toggle-tool-rag'))
    expect(onChange).toHaveBeenCalledWith([])
  })
})
