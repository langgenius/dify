import { render, screen } from '@testing-library/react'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'
import DifyLogo from './dify-logo'

vi.mock('@/hooks/use-theme', () => ({
  default: vi.fn(),
}))

vi.mock('@/utils/var', () => ({
  basePath: '/test-base-path',
}))

describe('DifyLogo', () => {
  const mockUseTheme = {
    theme: Theme.light,
    themes: ['light', 'dark'],
    setTheme: vi.fn(),
    resolvedTheme: Theme.light,
    systemTheme: Theme.light,
    forcedTheme: undefined,
  }

  beforeEach(() => {
    vi.mocked(useTheme).mockReturnValue(mockUseTheme as ReturnType<typeof useTheme>)
  })

  describe('Render', () => {
    it('renders correctly with default props', () => {
      render(<DifyLogo />)
      const img = screen.getByRole('img', { name: /dify logo/i })
      expect(img).toBeInTheDocument()
      expect(img).toHaveAttribute('src', '/test-base-path/logo/logo.svg')
    })
  })

  describe('Props', () => {
    it('applies custom size correctly', () => {
      const { rerender } = render(<DifyLogo size="large" />)
      let img = screen.getByRole('img', { name: /dify logo/i })
      expect(img).toHaveClass('w-16')
      expect(img).toHaveClass('h-7')

      rerender(<DifyLogo size="small" />)
      img = screen.getByRole('img', { name: /dify logo/i })
      expect(img).toHaveClass('w-9')
      expect(img).toHaveClass('h-4')
    })

    it('applies custom style correctly', () => {
      render(<DifyLogo style="monochromeWhite" />)
      const img = screen.getByRole('img', { name: /dify logo/i })
      expect(img).toHaveAttribute('src', '/test-base-path/logo/logo-monochrome-white.svg')
    })

    it('applies custom className', () => {
      render(<DifyLogo className="custom-test-class" />)
      const img = screen.getByRole('img', { name: /dify logo/i })
      expect(img).toHaveClass('custom-test-class')
    })
  })

  describe('Theme behavior', () => {
    it('uses monochromeWhite logo in dark theme when style is default', () => {
      vi.mocked(useTheme).mockReturnValue({
        ...mockUseTheme,
        theme: Theme.dark,
      } as ReturnType<typeof useTheme>)
      render(<DifyLogo style="default" />)
      const img = screen.getByRole('img', { name: /dify logo/i })
      expect(img).toHaveAttribute('src', '/test-base-path/logo/logo-monochrome-white.svg')
    })

    it('uses monochromeWhite logo in dark theme when style is monochromeWhite', () => {
      vi.mocked(useTheme).mockReturnValue({
        ...mockUseTheme,
        theme: Theme.dark,
      } as ReturnType<typeof useTheme>)
      render(<DifyLogo style="monochromeWhite" />)
      const img = screen.getByRole('img', { name: /dify logo/i })
      expect(img).toHaveAttribute('src', '/test-base-path/logo/logo-monochrome-white.svg')
    })

    it('uses default logo in light theme when style is default', () => {
      vi.mocked(useTheme).mockReturnValue({
        ...mockUseTheme,
        theme: Theme.light,
      } as ReturnType<typeof useTheme>)
      render(<DifyLogo style="default" />)
      const img = screen.getByRole('img', { name: /dify logo/i })
      expect(img).toHaveAttribute('src', '/test-base-path/logo/logo.svg')
    })
  })
})
