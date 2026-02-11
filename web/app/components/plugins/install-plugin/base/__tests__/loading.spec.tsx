import { render, screen } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../card/base/placeholder', () => ({
  default: () => <div data-testid="placeholder" />,
}))

describe('Loading', () => {
  let Loading: React.FC

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('../loading')
    Loading = mod.default
  })

  it('should render disabled unchecked checkbox', () => {
    render(<Loading />)

    expect(screen.getByTestId('checkbox-undefined')).toBeInTheDocument()
  })

  it('should render placeholder', () => {
    render(<Loading />)

    expect(screen.getByTestId('placeholder')).toBeInTheDocument()
  })
})
