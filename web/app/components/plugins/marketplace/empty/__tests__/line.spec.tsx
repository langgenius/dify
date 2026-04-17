import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Line from '../line'

const mockUseTheme = vi.fn()

vi.mock('@/hooks/use-theme', () => ({
  default: () => mockUseTheme(),
}))

describe('Line', () => {
  it('renders dark mode svg variant', () => {
    mockUseTheme.mockReturnValue({ theme: 'dark' })
    const { container } = render(<Line className="divider" />)
    const svg = container.querySelector('svg')

    expect(svg).toHaveAttribute('height', '240')
    expect(svg).toHaveAttribute('viewBox', '0 0 2 240')
    expect(svg).toHaveClass('divider')
  })

  it('renders light mode svg variant', () => {
    mockUseTheme.mockReturnValue({ theme: 'light' })
    const { container } = render(<Line />)
    const svg = container.querySelector('svg')

    expect(svg).toHaveAttribute('height', '241')
    expect(svg).toHaveAttribute('viewBox', '0 0 2 241')
  })
})
