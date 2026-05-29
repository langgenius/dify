import type { Plugin } from '../../../../types'
import type { VersionProps } from '@/app/components/plugins/types'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import MarketPlaceItem from '../marketplace-item'

const mockLoadedItem = vi.fn()

vi.mock('../../../base/loading', () => ({
  default: () => <div data-testid="loading">loading</div>,
}))

vi.mock('../loaded-item', () => ({
  default: (props: Record<string, unknown>) => {
    mockLoadedItem(props)
    return <div data-testid="loaded-item">loaded-item</div>
  },
}))

const payload = {
  plugin_id: 'plugin-1',
  org: 'dify',
  name: 'Marketplace Plugin',
  icon: 'icon.png',
} as Plugin

const versionInfo: VersionProps = {
  hasInstalled: false,
  installedVersion: '',
  toInstallVersion: '1.0.0',
}

describe('MarketPlaceItem', () => {
  it('renders loading when payload is absent', () => {
    render(
      <MarketPlaceItem
        checked={false}
        onCheckedChange={vi.fn()}
        version="1.0.0"
        versionInfo={versionInfo}
      />,
    )

    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('renders LoadedItem with marketplace payload and version', () => {
    render(
      <MarketPlaceItem
        checked
        onCheckedChange={vi.fn()}
        payload={payload}
        version="2.0.0"
        versionInfo={versionInfo}
      />,
    )

    expect(screen.getByTestId('loaded-item')).toBeInTheDocument()
    expect(mockLoadedItem).toHaveBeenCalledWith(expect.objectContaining({
      checked: true,
      isFromMarketPlace: true,
      versionInfo,
      payload: expect.objectContaining({
        ...payload,
        version: '2.0.0',
      }),
    }))
  })
})
