import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Description from '../description'

describe('Description', () => {
  it('renders description text', () => {
    render(<Description text="A great plugin" descriptionLineRows={1} />)
    expect(screen.getByText('A great plugin')).toBeInTheDocument()
  })

  it('applies truncate class for 1 line', () => {
    render(<Description text="Single line" descriptionLineRows={1} />)
    const el = screen.getByText('Single line')
    expect(el.className).toContain('truncate')
    expect(el.className).toContain('h-4')
  })

  it('applies line-clamp-2 class for 2 lines', () => {
    render(<Description text="Two lines" descriptionLineRows={2} />)
    const el = screen.getByText('Two lines')
    expect(el.className).toContain('line-clamp-2')
    expect(el.className).toContain('h-8')
  })

  it('applies line-clamp-3 class for 3 lines', () => {
    render(<Description text="Three lines" descriptionLineRows={3} />)
    const el = screen.getByText('Three lines')
    expect(el.className).toContain('line-clamp-3')
    expect(el.className).toContain('h-12')
  })

  it('applies custom className', () => {
    render(<Description text="test" descriptionLineRows={1} className="mt-2" />)
    const el = screen.getByText('test')
    expect(el.className).toContain('mt-2')
  })
})
