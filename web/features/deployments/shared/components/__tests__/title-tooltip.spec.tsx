import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { TitleTooltip } from '../title-tooltip'

function setElementSize(
  element: HTMLElement,
  {
    clientWidth,
    scrollWidth,
  }: {
    clientWidth: number
    scrollWidth: number
  },
) {
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

  it('shows duplicate content when the trigger is truncated', async () => {
    const user = userEvent.setup()
    render(
      <TitleTooltip content="Long deployment name">
        <p>Long deployment name</p>
      </TitleTooltip>,
    )

    const trigger = screen.getByText('Long deployment name')
    setElementSize(trigger, { clientWidth: 80, scrollWidth: 160 })
    await user.hover(trigger)

    await waitFor(() => {
      expect(screen.getAllByText('Long deployment name')).toHaveLength(2)
    })
  })

  it('shows content that adds information beyond the trigger text', async () => {
    const user = userEvent.setup()
    render(
      <TitleTooltip content="Disabled until an initial release exists">
        <button type="button">Deploy</button>
      </TitleTooltip>,
    )

    await user.hover(screen.getByRole('button', { name: 'Deploy' }))

    expect(await screen.findByText('Disabled until an initial release exists')).toBeInTheDocument()
  })
})
