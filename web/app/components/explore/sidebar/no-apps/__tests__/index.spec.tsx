import { render, screen } from '@testing-library/react'
import { Theme } from '@/types/app'
import NoApps from '../index'

let mockTheme = Theme.light

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.dify.ai${path}`,
}))

vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: mockTheme }),
}))

describe('NoApps', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTheme = Theme.light
  })

  describe('Rendering', () => {
    it('should render title, description and learn-more link', () => {
      render(<NoApps />)

      expect(screen.getByText('explore.sidebar.noApps.title')).toBeInTheDocument()
      expect(screen.getByText('explore.sidebar.noApps.description')).toBeInTheDocument()
      expect(screen.getByText('explore.sidebar.noApps.learnMore')).toBeInTheDocument()
    })

    it('should render learn-more as external link with correct href', () => {
      render(<NoApps />)

      const link = screen.getByText('explore.sidebar.noApps.learnMore')
      expect(link.tagName).toBe('A')
      expect(link).toHaveAttribute('href', 'https://docs.dify.ai/use-dify/publish/README')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })
  })

  describe('Theme', () => {
    it('should apply light theme background class in light mode', () => {
      mockTheme = Theme.light

      const { container } = render(<NoApps />)
      const bgDiv = container.querySelector('[class*="bg-contain"]')

      expect(bgDiv).toBeInTheDocument()
      expect(bgDiv?.className).toContain('light')
      expect(bgDiv?.className).not.toContain('dark')
    })

    it('should apply dark theme background class in dark mode', () => {
      mockTheme = Theme.dark

      const { container } = render(<NoApps />)
      const bgDiv = container.querySelector('[class*="bg-contain"]')

      expect(bgDiv).toBeInTheDocument()
      expect(bgDiv?.className).toContain('dark')
    })
  })
})
