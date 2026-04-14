import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StrategyPicker from '../strategy-picker'
import { AUTO_UPDATE_STRATEGY } from '../types'

let portalOpen = false

vi.mock('@/app/components/base/ui/button', () => ({
  Button: ({
    children,
  }: {
    children: React.ReactNode
  }) => <span data-testid="picker-button">{children}</span>,
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
      onClick: (event: { stopPropagation: () => void, nativeEvent: { stopImmediatePropagation: () => void } }) => void
    }) => (
      <button
        data-testid="trigger"
        onClick={() => onClick({
          stopPropagation: vi.fn(),
          nativeEvent: { stopImmediatePropagation: vi.fn() },
        })}
      >
        {children}
      </button>
    ),
    PortalToFollowElemContent: ({
      children,
    }: {
      children: React.ReactNode
    }) => portalOpen ? <div data-testid="portal-content">{children}</div> : null,
  }
})

describe('StrategyPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    portalOpen = false
  })

  it('renders the selected strategy label in the trigger', () => {
    render(
      <StrategyPicker
        value={AUTO_UPDATE_STRATEGY.fixOnly}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByTestId('trigger')).toHaveTextContent('plugin.autoUpdate.strategy.fixOnly.name')
  })

  it('opens the option list when the trigger is clicked', () => {
    render(
      <StrategyPicker
        value={AUTO_UPDATE_STRATEGY.disabled}
        onChange={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByTestId('trigger'))

    expect(screen.getByTestId('portal-content')).toBeInTheDocument()
    expect(screen.getByTestId('portal-content').querySelectorAll('svg')).toHaveLength(1)
    expect(screen.getByText('plugin.autoUpdate.strategy.latest.description')).toBeInTheDocument()
  })

  it('calls onChange when a new strategy is selected', () => {
    const onChange = vi.fn()
    render(
      <StrategyPicker
        value={AUTO_UPDATE_STRATEGY.disabled}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByTestId('trigger'))
    fireEvent.click(screen.getByText('plugin.autoUpdate.strategy.latest.name'))

    expect(onChange).toHaveBeenCalledWith(AUTO_UPDATE_STRATEGY.latest)
  })
})
