import { render, screen } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/app/components/base/checkbox', () => ({
  default: ({ checked, disabled }: { checked: boolean, disabled: boolean }) => (
    <input type="checkbox" data-testid="checkbox" checked={checked} disabled={disabled} readOnly />
  ),
}))

vi.mock('../../card/base/placeholder', () => ({
  default: () => <div data-testid="placeholder" />,
}))

describe('Loading', () => {
  let Loading: React.FC

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('./loading')
    Loading = mod.default
  })

  it('should render disabled unchecked checkbox', () => {
    render(<Loading />)

    const checkbox = screen.getByTestId('checkbox')
    expect(checkbox).toBeDisabled()
    expect(checkbox).not.toBeChecked()
  })

  it('should render placeholder', () => {
    render(<Loading />)

    expect(screen.getByTestId('placeholder')).toBeInTheDocument()
  })
})
