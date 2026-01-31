import { render, screen } from '@testing-library/react'
import * as React from 'react'
import Footer from './footer'

describe('Footer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<Footer />)
      expect(screen.getByRole('contentinfo')).toBeInTheDocument()
    })

    it('should display the community heading', () => {
      render(<Footer />)
      // Use pattern matching for resilient text assertions
      expect(screen.getByText('app.join')).toBeInTheDocument()
    })

    it('should display the community intro text', () => {
      render(<Footer />)
      expect(screen.getByText('app.communityIntro')).toBeInTheDocument()
    })
  })

  describe('Links', () => {
    it('should render GitHub link with correct href', () => {
      const { container } = render(<Footer />)
      const githubLink = container.querySelector('a[href="https://github.com/langgenius/dify"]')
      expect(githubLink).toBeInTheDocument()
    })

    it('should render Discord link with correct href', () => {
      const { container } = render(<Footer />)
      const discordLink = container.querySelector('a[href="https://discord.gg/FngNHpbcY7"]')
      expect(discordLink).toBeInTheDocument()
    })

    it('should render Forum link with correct href', () => {
      const { container } = render(<Footer />)
      const forumLink = container.querySelector('a[href="https://forum.dify.ai"]')
      expect(forumLink).toBeInTheDocument()
    })

    it('should have 3 community links', () => {
      render(<Footer />)
      const links = screen.getAllByRole('link')
      expect(links).toHaveLength(3)
    })

    it('should open links in new tab', () => {
      render(<Footer />)
      const links = screen.getAllByRole('link')
      links.forEach((link) => {
        expect(link).toHaveAttribute('target', '_blank')
        expect(link).toHaveAttribute('rel', 'noopener noreferrer')
      })
    })
  })

  describe('Styling', () => {
    it('should have correct footer styling', () => {
      render(<Footer />)
      const footer = screen.getByRole('contentinfo')
      expect(footer).toHaveClass('relative', 'shrink-0', 'grow-0')
    })

    it('should have gradient text styling on heading', () => {
      render(<Footer />)
      const heading = screen.getByText('app.join')
      expect(heading).toHaveClass('text-gradient')
    })
  })

  describe('Icons', () => {
    it('should render icons within links', () => {
      const { container } = render(<Footer />)
      const svgElements = container.querySelectorAll('svg')
      expect(svgElements.length).toBeGreaterThanOrEqual(3)
    })
  })

  describe('Edge Cases', () => {
    it('should handle multiple renders without issues', () => {
      const { rerender } = render(<Footer />)
      expect(screen.getByRole('contentinfo')).toBeInTheDocument()

      rerender(<Footer />)
      expect(screen.getByRole('contentinfo')).toBeInTheDocument()
    })
  })
})
