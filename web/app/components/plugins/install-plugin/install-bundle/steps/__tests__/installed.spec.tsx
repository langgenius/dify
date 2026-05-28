import type { InstallStatus, Plugin } from '../../../../types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Installed from '../installed'

const mockCard = vi.fn()

vi.mock('@/config', () => ({
  API_PREFIX: 'https://api.example.com',
  MARKETPLACE_API_PREFIX: 'https://marketplace.example.com',
}))

vi.mock('@/app/components/plugins/card', () => ({
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

const plugins = [
  {
    plugin_id: 'plugin-1',
    org: 'dify',
    name: 'Plugin One',
    icon: 'icon-1.png',
    version: '1.0.0',
  },
  {
    plugin_id: 'plugin-2',
    org: 'dify',
    name: 'Plugin Two',
    icon: 'icon-2.png',
    version: '2.0.0',
  },
] as Plugin[]

const installStatus: InstallStatus[] = [
  { success: true, isFromMarketPlace: true },
  { success: false, isFromMarketPlace: false },
]

describe('Installed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders plugin cards with install status and marketplace icon handling', () => {
    render(
      <Installed
        list={plugins}
        installStatus={installStatus}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getAllByTestId('card')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'common.operation.close' })).toBeInTheDocument()
    expect(screen.getByText('1.0.0')).toBeInTheDocument()
    expect(screen.getByText('2.0.0')).toBeInTheDocument()
    expect(mockCard).toHaveBeenNthCalledWith(1, expect.objectContaining({
      installed: true,
      installFailed: false,
      payload: expect.objectContaining({
        icon: 'https://marketplace.example.com/plugins/dify/Plugin One/icon',
      }),
    }))
    expect(mockCard).toHaveBeenNthCalledWith(2, expect.objectContaining({
      installed: false,
      installFailed: true,
      payload: expect.objectContaining({
        icon: 'https://api.example.com/icon-2.png',
      }),
    }))
  })

  it('calls onCancel when close button is clicked', () => {
    const onCancel = vi.fn()

    render(
      <Installed
        list={plugins}
        installStatus={installStatus}
        onCancel={onCancel}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.close' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('hides action button when isHideButton is true', () => {
    render(
      <Installed
        list={plugins}
        installStatus={installStatus}
        onCancel={vi.fn()}
        isHideButton
      />,
    )

    expect(screen.queryByRole('button', { name: 'common.operation.close' })).not.toBeInTheDocument()
  })
})
