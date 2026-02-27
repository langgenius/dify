import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import InfoPanel from '../InfoPanel'

// Mock useDocLink from @/context/i18n
vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.dify.ai${path}`,
}))

describe('InfoPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering: verifies the panel renders all expected content
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<InfoPanel />)
      expect(screen.getByText(/connectDatasetIntro\.title/)).toBeInTheDocument()
    })

    it('should render the title text', () => {
      render(<InfoPanel />)
      expect(screen.getByText(/connectDatasetIntro\.title/)).toBeInTheDocument()
    })

    it('should render the front content text', () => {
      render(<InfoPanel />)
      expect(screen.getByText(/connectDatasetIntro\.content\.front/)).toBeInTheDocument()
    })

    it('should render the content link', () => {
      render(<InfoPanel />)
      expect(screen.getByText(/connectDatasetIntro\.content\.link/)).toBeInTheDocument()
    })

    it('should render the end content text', () => {
      render(<InfoPanel />)
      expect(screen.getByText(/connectDatasetIntro\.content\.end/)).toBeInTheDocument()
    })

    it('should render the learn more link', () => {
      render(<InfoPanel />)
      expect(screen.getByText(/connectDatasetIntro\.learnMore/)).toBeInTheDocument()
    })

    it('should render the book icon', () => {
      const { container } = render(<InfoPanel />)
      const svgIcons = container.querySelectorAll('svg')
      expect(svgIcons.length).toBeGreaterThanOrEqual(1)
    })
  })

  // Props: tests links and their attributes
  describe('Links', () => {
    it('should have correct href for external knowledge API doc link', () => {
      render(<InfoPanel />)
      const docLink = screen.getByText(/connectDatasetIntro\.content\.link/)
      expect(docLink).toHaveAttribute('href', 'https://docs.dify.ai/use-dify/knowledge/external-knowledge-api')
    })

    it('should have correct href for learn more link', () => {
      render(<InfoPanel />)
      const learnMoreLink = screen.getByText(/connectDatasetIntro\.learnMore/)
      expect(learnMoreLink).toHaveAttribute('href', 'https://docs.dify.ai/use-dify/knowledge/connect-external-knowledge-base')
    })

    it('should open links in new tab', () => {
      render(<InfoPanel />)
      const docLink = screen.getByText(/connectDatasetIntro\.content\.link/)
      expect(docLink).toHaveAttribute('target', '_blank')
      expect(docLink).toHaveAttribute('rel', 'noopener noreferrer')

      const learnMoreLink = screen.getByText(/connectDatasetIntro\.learnMore/)
      expect(learnMoreLink).toHaveAttribute('target', '_blank')
      expect(learnMoreLink).toHaveAttribute('rel', 'noopener noreferrer')
    })
  })

  // Styles: checks structural class names
  describe('Styles', () => {
    it('should have correct container width', () => {
      const { container } = render(<InfoPanel />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('w-[360px]')
    })

    it('should have correct panel background', () => {
      const { container } = render(<InfoPanel />)
      const panel = container.querySelector('.bg-background-section')
      expect(panel).toBeInTheDocument()
    })
  })
})
