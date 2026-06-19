import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TitleTooltip } from './title-tooltip'

vi.mock('@langgenius/dify-ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => (
    <div data-testid="tooltip">
      {children}
    </div>
  ),
  TooltipTrigger: ({ render }: { render: ReactNode }) => <>{render}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => (
    <div role="tooltip">
      {children}
    </div>
  ),
}))

function setElementSize(element: HTMLElement, {
  clientWidth,
  scrollWidth,
}: {
  clientWidth: number
  scrollWidth: number
}) {
  Object.defineProperties(element, {
    clientWidth: { configurable: true, value: clientWidth },
    scrollWidth: { configurable: true, value: scrollWidth },
  })
}

describe('TitleTooltip', () => {
  it('does not show duplicate content when the trigger is not truncated', () => {
    render(
      <TitleTooltip content="11">
        <p>11</p>
      </TitleTooltip>,
    )

    fireEvent.pointerOver(screen.getByText('11'))

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('shows duplicate content when the trigger is truncated', () => {
    render(
      <TitleTooltip content="Long deployment name">
        <p>Long deployment name</p>
      </TitleTooltip>,
    )

    const trigger = screen.getByText('Long deployment name')
    setElementSize(trigger, { clientWidth: 80, scrollWidth: 160 })
    fireEvent.pointerOver(trigger)

    expect(screen.getByRole('tooltip')).toHaveTextContent('Long deployment name')
  })

  it('shows content that adds information beyond the trigger text', () => {
    render(
      <TitleTooltip content="Disabled until an initial release exists">
        <button type="button">Deploy</button>
      </TitleTooltip>,
    )

    fireEvent.pointerOver(screen.getByRole('button', { name: 'Deploy' }))

    expect(screen.getByRole('tooltip')).toHaveTextContent('Disabled until an initial release exists')
  })
})
