import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PluginVersionPicker from '../plugin-version-picker'

type VersionItem = {
  version: string
  unique_identifier: string
  created_at: string
}

const mockVersionList = vi.hoisted(() => ({
  data: {
    versions: [] as VersionItem[],
  },
}))

const mockUseVersionListOfPlugin = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatDate: (value: string, format: string) => `${value}:${format}`,
  }),
}))

vi.mock('@/service/use-plugins', () => ({
  useVersionListOfPlugin: mockUseVersionListOfPlugin.mockImplementation(() => ({
    data: mockVersionList,
    isLoading: false,
  })),
}))

describe('PluginVersionPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseVersionListOfPlugin.mockReturnValue({
      data: mockVersionList,
      isLoading: false,
    })
    mockVersionList.data.versions = [
      {
        version: '2.0.0',
        unique_identifier: 'uid-current',
        created_at: '2024-01-02',
      },
      {
        version: '1.0.0',
        unique_identifier: 'uid-old',
        created_at: '2023-12-01',
      },
    ]
  })

  it('loads versions only while the popover is open', () => {
    const { rerender } = render(
      <PluginVersionPicker
        isShow={false}
        onShowChange={vi.fn()}
        pluginID="plugin-1"
        currentVersion="2.0.0"
        trigger={<span>trigger</span>}
        onSelect={vi.fn()}
      />,
    )

    expect(mockUseVersionListOfPlugin).toHaveBeenLastCalledWith('plugin-1', false)

    rerender(
      <PluginVersionPicker
        isShow
        onShowChange={vi.fn()}
        pluginID="plugin-1"
        currentVersion="2.0.0"
        trigger={<span>trigger</span>}
        onSelect={vi.fn()}
      />,
    )

    expect(mockUseVersionListOfPlugin).toHaveBeenLastCalledWith('plugin-1', true)
  })

  it('shows a loading state while versions are loading', () => {
    mockUseVersionListOfPlugin.mockReturnValue({
      data: undefined,
      isLoading: true,
    })

    render(
      <PluginVersionPicker
        isShow
        onShowChange={vi.fn()}
        pluginID="plugin-1"
        currentVersion="2.0.0"
        trigger={<span>trigger</span>}
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByRole('status', { name: 'common.loading' })).toBeInTheDocument()
    expect(screen.queryByText('2.0.0')).not.toBeInTheDocument()
  })

  it('renders version options and highlights the current version', () => {
    render(
      <PluginVersionPicker
        isShow
        onShowChange={vi.fn()}
        pluginID="plugin-1"
        currentVersion="2.0.0"
        trigger={<span>trigger</span>}
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByText('plugin.detailPanel.switchVersion')).toBeInTheDocument()
    expect(screen.getByText('2.0.0')).toBeInTheDocument()
    expect(screen.getByText('2024-01-02:appLog.dateTimeFormat')).toBeInTheDocument()
    expect(screen.getByText('CURRENT')).toBeInTheDocument()
  })

  it('renders figma-aligned version rows', () => {
    render(
      <PluginVersionPicker
        isShow
        onShowChange={vi.fn()}
        pluginID="plugin-1"
        currentVersion="2.0.0"
        trigger={<span>trigger</span>}
        onSelect={vi.fn()}
      />,
    )

    const currentVersion = screen.getByText('2.0.0')
    const currentBadge = screen.getByText('CURRENT')
    const oldVersion = screen.getByText('1.0.0')

    expect(screen.getByText('plugin.detailPanel.switchVersion')).toHaveClass(
      'px-3',
      'pb-0.5',
      'pt-1',
    )
    expect(currentVersion.closest('.cursor-default')).toHaveClass('px-2', 'py-1', 'opacity-30')
    expect(oldVersion.closest('.cursor-pointer')).toHaveClass('px-2', 'py-1')
    expect(currentVersion.parentElement).toHaveClass('min-h-5', 'gap-1', 'px-1')
    expect(currentBadge).toHaveClass('bg-components-badge-bg-dimm')
  })

  it('calls onSelect with downgrade metadata and closes the picker', async () => {
    const onSelect = vi.fn()
    const onShowChange = vi.fn()
    const user = userEvent.setup()

    render(
      <PluginVersionPicker
        isShow
        onShowChange={onShowChange}
        pluginID="plugin-1"
        currentVersion="2.0.0"
        trigger={<span>trigger</span>}
        onSelect={onSelect}
      />,
    )

    await user.click(screen.getByText('1.0.0'))

    expect(onSelect).toHaveBeenCalledWith({
      version: '1.0.0',
      unique_identifier: 'uid-old',
      isDowngrade: true,
    })
    expect(onShowChange).toHaveBeenCalledWith(false)
  })

  it('does not call onSelect when the current version is clicked', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()

    render(
      <PluginVersionPicker
        isShow
        onShowChange={vi.fn()}
        pluginID="plugin-1"
        currentVersion="2.0.0"
        trigger={<span>trigger</span>}
        onSelect={onSelect}
      />,
    )

    await user.click(screen.getByText('2.0.0'))

    expect(onSelect).not.toHaveBeenCalled()
  })
})
