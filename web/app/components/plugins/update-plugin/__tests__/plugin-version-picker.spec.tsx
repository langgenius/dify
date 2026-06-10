import { fireEvent, render, screen } from '@testing-library/react'
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

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatDate: (value: string, format: string) => `${value}:${format}`,
  }),
}))

vi.mock('@/service/use-plugins', () => ({
  useVersionListOfPlugin: () => ({
    data: mockVersionList,
  }),
}))

describe('PluginVersionPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('calls onSelect with downgrade metadata and closes the picker', () => {
    const onSelect = vi.fn()
    const onShowChange = vi.fn()

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

    fireEvent.click(screen.getByText('1.0.0'))

    expect(onSelect).toHaveBeenCalledWith({
      version: '1.0.0',
      unique_identifier: 'uid-old',
      isDowngrade: true,
    })
    expect(onShowChange).toHaveBeenCalledWith(false)
  })

  it('does not call onSelect when the current version is clicked', () => {
    const onSelect = vi.fn()

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

    fireEvent.click(screen.getByText('2.0.0'))

    expect(onSelect).not.toHaveBeenCalled()
  })
})
