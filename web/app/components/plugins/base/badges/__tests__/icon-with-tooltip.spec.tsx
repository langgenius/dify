import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Theme } from '@/types/app'
import IconWithTooltip from '../icon-with-tooltip'

const LightIcon = () => <span>Light icon</span>
const DarkIcon = () => <span>Dark icon</span>

describe('IconWithTooltip', () => {
  it('renders the icon for the current theme', () => {
    const { rerender } = render(
      <IconWithTooltip theme={Theme.light} BadgeIconLight={LightIcon} BadgeIconDark={DarkIcon} />,
    )

    expect(screen.getByText('Light icon')).toBeInTheDocument()
    expect(screen.queryByText('Dark icon')).not.toBeInTheDocument()

    rerender(
      <IconWithTooltip theme={Theme.dark} BadgeIconLight={LightIcon} BadgeIconDark={DarkIcon} />,
    )

    expect(screen.getByText('Dark icon')).toBeInTheDocument()
    expect(screen.queryByText('Light icon')).not.toBeInTheDocument()
  })

  it('exposes tooltip content as the icon accessible name', () => {
    render(
      <IconWithTooltip
        theme={Theme.light}
        BadgeIconLight={LightIcon}
        BadgeIconDark={DarkIcon}
        popupContent="Partner plugin"
      />,
    )

    expect(screen.getByLabelText('Partner plugin')).toBeInTheDocument()
  })
})
