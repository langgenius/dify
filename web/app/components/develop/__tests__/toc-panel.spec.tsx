import type { TocItem } from '../hooks/use-doc-toc'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TocPanel from '../toc-panel'

/**
 * Unit tests for the TocPanel presentational component.
 * Covers collapsed/expanded states, item rendering, active section, and callbacks.
 */
describe('TocPanel', () => {
  const defaultProps = {
    toc: [] as TocItem[],
    activeSection: '',
    isTocExpanded: false,
    onToggle: vi.fn(),
    onItemClick: vi.fn(),
  }

  const sampleToc: TocItem[] = [
    { href: '#introduction', text: 'Introduction' },
    { href: '#authentication', text: 'Authentication' },
    { href: '#endpoints', text: 'Endpoints' },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Covers collapsed state rendering
  describe('collapsed state', () => {
    it('should render expand button when collapsed', () => {
      render(<TocPanel {...defaultProps} />)

      expect(screen.getByLabelText('Open table of contents')).toBeInTheDocument()
    })

    it('should not render nav or toc items when collapsed', () => {
      render(<TocPanel {...defaultProps} toc={sampleToc} />)

      expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
      expect(screen.queryByText('Introduction')).not.toBeInTheDocument()
    })

    it('should call onToggle(true) when expand button is clicked', () => {
      const onToggle = vi.fn()
      render(<TocPanel {...defaultProps} onToggle={onToggle} />)

      fireEvent.click(screen.getByLabelText('Open table of contents'))

      expect(onToggle).toHaveBeenCalledWith(true)
    })
  })

  // Covers expanded state with empty toc
  describe('expanded state - empty', () => {
    it('should render nav with empty message when toc is empty', () => {
      render(<TocPanel {...defaultProps} isTocExpanded />)

      expect(screen.getByRole('navigation')).toBeInTheDocument()
      expect(screen.getByText('appApi.develop.noContent')).toBeInTheDocument()
    })

    it('should render TOC header with title', () => {
      render(<TocPanel {...defaultProps} isTocExpanded />)

      expect(screen.getByText('appApi.develop.toc')).toBeInTheDocument()
    })

    it('should call onToggle(false) when close button is clicked', () => {
      const onToggle = vi.fn()
      render(<TocPanel {...defaultProps} isTocExpanded onToggle={onToggle} />)

      fireEvent.click(screen.getByLabelText('Close'))

      expect(onToggle).toHaveBeenCalledWith(false)
    })
  })

  // Covers expanded state with toc items
  describe('expanded state - with items', () => {
    it('should render all toc items as links', () => {
      render(<TocPanel {...defaultProps} isTocExpanded toc={sampleToc} />)

      expect(screen.getByText('Introduction')).toBeInTheDocument()
      expect(screen.getByText('Authentication')).toBeInTheDocument()
      expect(screen.getByText('Endpoints')).toBeInTheDocument()
    })

    it('should render links with correct href attributes', () => {
      render(<TocPanel {...defaultProps} isTocExpanded toc={sampleToc} />)

      const links = screen.getAllByRole('link')
      expect(links).toHaveLength(3)
      expect(links[0]).toHaveAttribute('href', '#introduction')
      expect(links[1]).toHaveAttribute('href', '#authentication')
      expect(links[2]).toHaveAttribute('href', '#endpoints')
    })

    it('should not render empty message when toc has items', () => {
      render(<TocPanel {...defaultProps} isTocExpanded toc={sampleToc} />)

      expect(screen.queryByText('appApi.develop.noContent')).not.toBeInTheDocument()
    })
  })

  // Covers active section highlighting
  describe('active section', () => {
    it('should apply active style to the matching toc item', () => {
      render(
        <TocPanel {...defaultProps} isTocExpanded toc={sampleToc} activeSection="authentication" />,
      )

      const activeLink = screen.getByText('Authentication').closest('a')
      expect(activeLink?.className).toContain('font-medium')
      expect(activeLink?.className).toContain('text-text-primary')
    })

    it('should apply inactive style to non-matching items', () => {
      render(
        <TocPanel {...defaultProps} isTocExpanded toc={sampleToc} activeSection="authentication" />,
      )

      const inactiveLink = screen.getByText('Introduction').closest('a')
      expect(inactiveLink?.className).toContain('text-text-tertiary')
      expect(inactiveLink?.className).not.toContain('font-medium')
    })

    it('should apply active indicator dot to active item', () => {
      render(
        <TocPanel {...defaultProps} isTocExpanded toc={sampleToc} activeSection="endpoints" />,
      )

      const activeLink = screen.getByText('Endpoints').closest('a')
      const activeDot = activeLink?.querySelector('span:first-child')
      expect(activeDot?.className).toContain('bg-text-accent')
    })
  })

  // Covers click event delegation
  describe('item click handling', () => {
    it('should call onItemClick with the event and item when a link is clicked', () => {
      const onItemClick = vi.fn()
      render(
        <TocPanel {...defaultProps} isTocExpanded toc={sampleToc} onItemClick={onItemClick} />,
      )

      fireEvent.click(screen.getByText('Authentication'))

      expect(onItemClick).toHaveBeenCalledTimes(1)
      expect(onItemClick).toHaveBeenCalledWith(
        expect.any(Object),
        { href: '#authentication', text: 'Authentication' },
      )
    })

    it('should call onItemClick for each clicked item independently', () => {
      const onItemClick = vi.fn()
      render(
        <TocPanel {...defaultProps} isTocExpanded toc={sampleToc} onItemClick={onItemClick} />,
      )

      fireEvent.click(screen.getByText('Introduction'))
      fireEvent.click(screen.getByText('Endpoints'))

      expect(onItemClick).toHaveBeenCalledTimes(2)
    })
  })

  // Covers edge cases
  describe('edge cases', () => {
    it('should handle single item toc', () => {
      const singleItem = [{ href: '#only', text: 'Only Section' }]
      render(<TocPanel {...defaultProps} isTocExpanded toc={singleItem} activeSection="only" />)

      expect(screen.getByText('Only Section')).toBeInTheDocument()
      expect(screen.getAllByRole('link')).toHaveLength(1)
    })

    it('should handle toc items with empty text', () => {
      const emptyTextItem = [{ href: '#empty', text: '' }]
      render(<TocPanel {...defaultProps} isTocExpanded toc={emptyTextItem} />)

      expect(screen.getAllByRole('link')).toHaveLength(1)
    })

    it('should handle active section that does not match any item', () => {
      render(
        <TocPanel {...defaultProps} isTocExpanded toc={sampleToc} activeSection="nonexistent" />,
      )

      // All items should be in inactive style
      const links = screen.getAllByRole('link')
      links.forEach((link) => {
        expect(link.className).toContain('text-text-tertiary')
        expect(link.className).not.toContain('font-medium')
      })
    })
  })
})
