import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PluginVersionPicker from '../plugin-version-picker'

let popoverOpen = false
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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => {
      if (key === 'dateTimeFormat' && options?.ns === 'appLog')
        return 'YYYY-MM-DD HH:mm'
      return options?.ns ? `${options.ns}.${key}` : key
    },
  }),
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

vi.mock('@/app/components/base/badge', () => ({
  default: ({ text, children }: { text?: string, children?: React.ReactNode }) => <span data-testid="badge">{text || children}</span>,
}))

vi.mock('@/app/components/base/ui/popover', async () => {
  const React = await import('react')
  return {
    Popover: ({
      open,
      children,
    }: {
      open: boolean
      children: React.ReactNode
    }) => {
      popoverOpen = open
      return <div>{children}</div>
    },
    PopoverTrigger: ({
      children,
    }: {
      children: React.ReactNode
    }) => <div data-testid="popover-trigger">{children}</div>,
    PopoverContent: ({
      children,
    }: {
      children: React.ReactNode
    }) => popoverOpen ? <div data-testid="popover-content">{children}</div> : null,
  }
})

describe('PluginVersionPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    popoverOpen = false
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
    expect(screen.getByText('2024-01-02:YYYY-MM-DD')).toBeInTheDocument()
    expect(screen.getByTestId('badge')).toHaveTextContent('CURRENT')
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
