import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import PluginsPicker from '../plugins-picker'
import { AUTO_UPDATE_MODE } from '../types'

const mockToolPicker = vi.fn()
const mockInstalledPluginList = vi.hoisted(() => ({
  data: {
    plugins: [
      {
        plugin_id: 'dify/model-plugin',
        declaration: { category: 'model' },
      },
      {
        plugin_id: 'dify/tool-plugin',
        declaration: { category: 'tool' },
      },
      {
        plugin_id: 'dify/datasource-plugin',
        declaration: { category: 'datasource' },
      },
    ],
  },
}))

vi.mock('@/service/use-plugins', () => ({
  useInstalledPluginList: () => mockInstalledPluginList,
}))

vi.mock('@langgenius/dify-ui/button', () => ({
  Button: ({
    children,
  }: {
    children: React.ReactNode
  }) => <button>{children}</button>,
}))

vi.mock('../no-plugin-selected', () => ({
  default: ({ updateMode }: { updateMode: AUTO_UPDATE_MODE }) => <div data-testid="no-plugin-selected">{updateMode}</div>,
}))

vi.mock('../plugins-selected', () => ({
  default: ({ plugins }: { plugins: string[] }) => <div data-testid="plugins-selected">{plugins.join(',')}</div>,
}))

vi.mock('../tool-picker', () => ({
  default: (props: Record<string, unknown>) => {
    mockToolPicker(props)
    return <div data-testid="tool-picker">tool-picker</div>
  },
}))

describe('PluginsPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the empty state when no plugins are selected', () => {
    render(
      <PluginsPicker
        updateMode={AUTO_UPDATE_MODE.partial}
        value={[]}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByTestId('no-plugin-selected')).toHaveTextContent(AUTO_UPDATE_MODE.partial)
    expect(screen.queryByTestId('plugins-selected')).not.toBeInTheDocument()
    expect(mockToolPicker).toHaveBeenCalledWith(expect.objectContaining({
      value: [],
      isShow: false,
      onShowChange: expect.any(Function),
    }))
  })

  it('renders selected plugins summary and clears them', () => {
    const onChange = vi.fn()
    render(
      <PluginsPicker
        updateMode={AUTO_UPDATE_MODE.exclude}
        value={['dify/plugin-1', 'dify/plugin-2']}
        onChange={onChange}
      />,
    )

    expect(screen.getByText('plugin.autoUpdate.excludeUpdate:{"count":2,"num":2}')).toBeInTheDocument()
    expect(screen.getByTestId('plugins-selected')).toHaveTextContent('dify/plugin-1,dify/plugin-2')

    fireEvent.click(screen.getByRole('button', { name: 'plugin.autoUpdate.operation.clearAll' }))

    expect(onChange).toHaveBeenCalledWith([])
  })

  it('passes the select button trigger into ToolPicker', () => {
    render(
      <PluginsPicker
        updateMode={AUTO_UPDATE_MODE.partial}
        value={[]}
        onChange={vi.fn()}
        integrationCategory={PluginCategoryEnum.model}
      />,
    )

    expect(screen.getByTestId('tool-picker')).toBeInTheDocument()
    expect(mockToolPicker).toHaveBeenCalledWith(expect.objectContaining({
      trigger: expect.anything(),
      integrationCategory: PluginCategoryEnum.model,
    }))
  })

  it('shows and edits only selected plugins from the provided integration category', () => {
    const onChange = vi.fn()

    render(
      <PluginsPicker
        updateMode={AUTO_UPDATE_MODE.exclude}
        value={['dify/model-plugin', 'dify/tool-plugin', 'dify/datasource-plugin']}
        onChange={onChange}
        integrationCategory={PluginCategoryEnum.tool}
      />,
    )

    expect(screen.getByText('plugin.autoUpdate.excludeUpdate:{"count":1,"num":1}')).toBeInTheDocument()
    expect(screen.getByTestId('plugins-selected')).toHaveTextContent('dify/tool-plugin')
    expect(screen.getByTestId('plugins-selected')).not.toHaveTextContent('dify/model-plugin')

    const toolPickerProps = mockToolPicker.mock.lastCall?.[0] as {
      value: string[]
      onChange: (value: string[]) => void
    }
    expect(toolPickerProps.value).toEqual(['dify/tool-plugin'])

    toolPickerProps.onChange(['dify/new-tool-plugin'])
    expect(onChange).toHaveBeenCalledWith(['dify/model-plugin', 'dify/datasource-plugin', 'dify/new-tool-plugin'])

    fireEvent.click(screen.getByRole('button', { name: 'plugin.autoUpdate.operation.clearAll' }))
    expect(onChange).toHaveBeenLastCalledWith(['dify/model-plugin', 'dify/datasource-plugin'])
  })
})
