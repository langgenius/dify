import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import PluginsPicker from '../plugins-picker'
import { AUTO_UPDATE_MODE } from '../types'

const mockToolPicker = vi.fn()

vi.mock('@/app/components/base/ui/button', () => ({
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

    expect(screen.getByText('plugin.autoUpdate.excludeUpdate:{"num":2}')).toBeInTheDocument()
    expect(screen.getByTestId('plugins-selected')).toHaveTextContent('dify/plugin-1,dify/plugin-2')

    fireEvent.click(screen.getByText('plugin.autoUpdate.operation.clearAll'))

    expect(onChange).toHaveBeenCalledWith([])
  })

  it('passes the select button trigger into ToolPicker', () => {
    render(
      <PluginsPicker
        updateMode={AUTO_UPDATE_MODE.partial}
        value={[]}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByTestId('tool-picker')).toBeInTheDocument()
    expect(mockToolPicker).toHaveBeenCalledWith(expect.objectContaining({
      trigger: expect.anything(),
    }))
  })
})
