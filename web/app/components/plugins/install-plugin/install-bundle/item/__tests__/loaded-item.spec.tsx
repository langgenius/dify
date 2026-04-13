import type { Plugin } from '../../../../types'
import type { VersionProps } from '@/app/components/plugins/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LoadedItem from '../loaded-item'

const mockCheckbox = vi.fn()
const mockCard = vi.fn()
const mockVersion = vi.fn()
const mockUsePluginInstallLimit = vi.fn()

vi.mock('@/config', () => ({
  API_PREFIX: 'https://api.example.com',
  MARKETPLACE_API_PREFIX: 'https://marketplace.example.com',
}))

vi.mock('@/app/components/base/checkbox', () => ({
  default: (props: { checked: boolean, disabled: boolean, onCheck: () => void }) => {
    mockCheckbox(props)
    return (
      <button
        data-testid="checkbox"
        disabled={props.disabled}
        onClick={props.onCheck}
      >
        {String(props.checked)}
      </button>
    )
  },
}))

vi.mock('../../../../card', () => ({
  default: (props: { titleLeft?: React.ReactNode }) => {
    mockCard(props)
    return (
      <div data-testid="card">
        {props.titleLeft}
      </div>
    )
  },
}))

vi.mock('../../../base/use-get-icon', () => ({
  default: () => ({
    getIconUrl: (icon: string) => `https://api.example.com/${icon}`,
  }),
}))

vi.mock('../../../base/version', () => ({
  default: (props: Record<string, unknown>) => {
    mockVersion(props)
    return <div data-testid="version">version</div>
  },
}))

vi.mock('../../../hooks/use-install-plugin-limit', () => ({
  default: (payload: Plugin) => mockUsePluginInstallLimit(payload),
}))

const payload = {
  plugin_id: 'plugin-1',
  org: 'dify',
  name: 'Loaded Plugin',
  icon: 'icon.png',
  version: '1.0.0',
} as Plugin

const versionInfo: VersionProps = {
  hasInstalled: false,
  installedVersion: '',
  toInstallVersion: '0.9.0',
}

describe('LoadedItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUsePluginInstallLimit.mockReturnValue({ canInstall: true })
  })

  it('uses local icon url and forwards version title for non-marketplace plugins', () => {
    render(
      <LoadedItem
        checked
        onCheckedChange={vi.fn()}
        payload={payload}
        versionInfo={versionInfo}
      />,
    )

    expect(screen.getByTestId('card')).toBeInTheDocument()
    expect(mockUsePluginInstallLimit).toHaveBeenCalledWith(payload)
    expect(mockCard).toHaveBeenCalledWith(expect.objectContaining({
      limitedInstall: false,
      payload: expect.objectContaining({
        ...payload,
        icon: 'https://api.example.com/icon.png',
      }),
      titleLeft: expect.anything(),
    }))
    expect(mockVersion).toHaveBeenCalledWith(expect.objectContaining({
      hasInstalled: false,
      installedVersion: '',
      toInstallVersion: '1.0.0',
    }))
  })

  it('uses marketplace icon url and disables checkbox when install limit is reached', () => {
    mockUsePluginInstallLimit.mockReturnValue({ canInstall: false })

    render(
      <LoadedItem
        checked={false}
        onCheckedChange={vi.fn()}
        payload={payload}
        isFromMarketPlace
        versionInfo={versionInfo}
      />,
    )

    expect(screen.getByTestId('checkbox')).toBeDisabled()
    expect(mockCard).toHaveBeenCalledWith(expect.objectContaining({
      limitedInstall: true,
      payload: expect.objectContaining({
        icon: 'https://marketplace.example.com/plugins/dify/Loaded Plugin/icon',
      }),
    }))
  })

  it('calls onCheckedChange with payload when checkbox is toggled', () => {
    const onCheckedChange = vi.fn()

    render(
      <LoadedItem
        checked={false}
        onCheckedChange={onCheckedChange}
        payload={payload}
        versionInfo={versionInfo}
      />,
    )

    fireEvent.click(screen.getByTestId('checkbox'))

    expect(onCheckedChange).toHaveBeenCalledWith(payload)
  })

  it('omits version badge when payload has no version', () => {
    render(
      <LoadedItem
        checked={false}
        onCheckedChange={vi.fn()}
        payload={{ ...payload, version: '' }}
        versionInfo={versionInfo}
      />,
    )

    expect(mockCard).toHaveBeenCalledWith(expect.objectContaining({
      titleLeft: null,
    }))
  })
})
