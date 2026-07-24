import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CardMoreInfo from '../card-more-info'

vi.mock('../base/download-count', () => ({
  default: ({ downloadCount }: { downloadCount: number }) => (
    <span data-testid="download-count">{downloadCount}</span>
  ),
}))

describe('CardMoreInfo', () => {
  it('renders tags with # prefix', () => {
    render(<CardMoreInfo tags={['search', 'agent']} />)
    expect(screen.getByText('search')).toBeInTheDocument()
    expect(screen.getByText('agent')).toBeInTheDocument()
    // # prefixes
    const hashmarks = screen.getAllByText('#')
    expect(hashmarks).toHaveLength(2)
  })

  it('renders download count when provided', () => {
    render(<CardMoreInfo downloadCount={1000} tags={[]} />)
    expect(screen.getByTestId('download-count')).toHaveTextContent('1000')
  })

  it('does not render download count when undefined', () => {
    render(<CardMoreInfo tags={['tag1']} />)
    expect(screen.queryByTestId('download-count')).not.toBeInTheDocument()
  })

  it('renders separator between download count and tags', () => {
    render(<CardMoreInfo downloadCount={500} tags={['test']} />)
    expect(screen.getByText('·')).toBeInTheDocument()
  })

  it('does not render separator when no tags', () => {
    render(<CardMoreInfo downloadCount={500} tags={[]} />)
    expect(screen.queryByText('·')).not.toBeInTheDocument()
  })

  it('does not render separator when no download count', () => {
    render(<CardMoreInfo tags={['tag1']} />)
    expect(screen.queryByText('·')).not.toBeInTheDocument()
  })

  it('handles empty tags array', () => {
    const { container } = render(<CardMoreInfo tags={[]} />)
    expect(container.firstChild).toBeInTheDocument()
  })
})
