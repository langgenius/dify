import { render, screen } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/components/base/icons/src/public/plugins/VerifiedDark', () => ({
  default: () => <span data-testid="verified-dark" />,
}))

vi.mock('@/app/components/base/icons/src/public/plugins/VerifiedLight', () => ({
  default: () => <span data-testid="verified-light" />,
}))

vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: 'light' }),
}))

vi.mock('../icon-with-tooltip', () => ({
  default: ({ popupContent, BadgeIconLight, BadgeIconDark, theme }: {
    popupContent: string
    BadgeIconLight: React.FC
    BadgeIconDark: React.FC
    theme: string
    [key: string]: unknown
  }) => (
    <div data-testid="icon-with-tooltip" data-popup={popupContent}>
      {theme === 'light' ? <BadgeIconLight /> : <BadgeIconDark />}
    </div>
  ),
}))

describe('Verified', () => {
  let Verified: (typeof import('../verified'))['default']

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('../verified')
    Verified = mod.default
  })

  it('should render with tooltip text', () => {
    render(<Verified text="Verified Plugin" />)

    const tooltip = screen.getByTestId('icon-with-tooltip')
    expect(tooltip).toHaveAttribute('data-popup', 'Verified Plugin')
  })

  it('should render light theme icon by default', () => {
    render(<Verified text="Verified" />)

    expect(screen.getByTestId('verified-light')).toBeInTheDocument()
  })
})
