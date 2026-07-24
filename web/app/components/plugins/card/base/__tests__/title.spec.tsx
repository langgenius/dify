import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Title from '../title'

describe('Title', () => {
  it('renders the title text', () => {
    render(<Title title="Test Plugin" />)
    expect(screen.getByText('Test Plugin')).toBeInTheDocument()
  })

  it('renders with truncate class for long text', () => {
    render(<Title title="A very long title that should be truncated" />)
    const el = screen.getByText('A very long title that should be truncated')
    expect(el.className).toContain('truncate')
  })

  it('renders empty string without error', () => {
    const { container } = render(<Title title="" />)
    expect(container.firstChild).toBeInTheDocument()
  })
})
