import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import IconWithTooltip from '../icon-with-tooltip'

describe('IconWithTooltip', () => {
  it('exposes the badge meaning without opening the tooltip', () => {
    render(
      <IconWithTooltip
        lightIconClassName="i-custom-public-plugins-partner-light"
        darkIconClassName="i-custom-public-plugins-partner-dark"
        popupContent="Partner plugin"
      />,
    )

    expect(screen.getByText('Partner plugin')).toBeInTheDocument()
  })
})
