import type { TocItem } from '../hooks/use-doc-toc'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TocPanel from '../toc-panel'

const toc: TocItem[] = [
  { href: '#introduction', text: 'Introduction' },
  { href: '#authentication', text: 'Authentication' },
]

const defaultProps = {
  toc,
  activeSection: '',
  isTocExpanded: false,
  onToggle: vi.fn(),
  onItemClick: vi.fn(),
}

describe('TocPanel', () => {
  it('opens and closes the table of contents', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    const { rerender } = render(<TocPanel {...defaultProps} onToggle={onToggle} />)

    await user.click(screen.getByRole('button', { name: 'Open table of contents' }))
    expect(onToggle).toHaveBeenCalledWith(true)

    rerender(<TocPanel {...defaultProps} isTocExpanded onToggle={onToggle} />)
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onToggle).toHaveBeenLastCalledWith(false)
  })

  it('renders navigable document sections', () => {
    render(<TocPanel {...defaultProps} isTocExpanded />)

    expect(screen.getByRole('link', { name: 'Introduction' })).toHaveAttribute(
      'href',
      '#introduction',
    )
    expect(screen.getByRole('link', { name: 'Authentication' })).toHaveAttribute(
      'href',
      '#authentication',
    )
  })

  it('reports the selected section', async () => {
    const user = userEvent.setup()
    const onItemClick = vi.fn()
    render(<TocPanel {...defaultProps} isTocExpanded onItemClick={onItemClick} />)

    await user.click(screen.getByRole('link', { name: 'Authentication' }))

    expect(onItemClick).toHaveBeenCalledWith(expect.any(Object), toc[1])
  })
})
