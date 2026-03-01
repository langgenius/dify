import { render, screen } from '@testing-library/react'
import Badge from './badge'

describe('Badge', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<Badge text="beta" />)
      expect(screen.getByText(/beta/i)).toBeInTheDocument()
    })

    it('should render with children instead of text', () => {
      render(<Badge><span>child content</span></Badge>)
      expect(screen.getByText(/child content/i)).toBeInTheDocument()
    })

    it('should render with no text or children', () => {
      const { container } = render(<Badge />)
      expect(container.firstChild).toBeInTheDocument()
      expect(container.firstChild).toHaveTextContent('')
    })
  })

  describe('Props', () => {
    it('should apply custom className', () => {
      const { container } = render(<Badge text="test" className="my-custom" />)
      const badge = container.firstChild as HTMLElement
      expect(badge).toHaveClass('my-custom')
    })

    it('should retain base classes when custom className is applied', () => {
      const { container } = render(<Badge text="test" className="my-custom" />)
      const badge = container.firstChild as HTMLElement
      expect(badge).toHaveClass('relative', 'inline-flex', 'h-5', 'items-center')
    })

    it('should apply uppercase class by default', () => {
      const { container } = render(<Badge text="test" />)
      const badge = container.firstChild as HTMLElement
      expect(badge).toHaveClass('system-2xs-medium-uppercase')
    })

    it('should apply non-uppercase class when uppercase is false', () => {
      const { container } = render(<Badge text="test" uppercase={false} />)
      const badge = container.firstChild as HTMLElement
      expect(badge).toHaveClass('system-xs-medium')
      expect(badge).not.toHaveClass('system-2xs-medium-uppercase')
    })

    it('should render red corner mark when hasRedCornerMark is true', () => {
      const { container } = render(<Badge text="test" hasRedCornerMark />)
      const mark = container.querySelector('.bg-components-badge-status-light-error-bg')
      expect(mark).toBeInTheDocument()
    })

    it('should not render red corner mark by default', () => {
      const { container } = render(<Badge text="test" />)
      const mark = container.querySelector('.bg-components-badge-status-light-error-bg')
      expect(mark).not.toBeInTheDocument()
    })

    it('should prioritize children over text', () => {
      render(<Badge text="text content"><span>child wins</span></Badge>)
      expect(screen.getByText(/child wins/i)).toBeInTheDocument()
      expect(screen.queryByText(/text content/i)).not.toBeInTheDocument()
    })

    it('should render ReactNode as text prop', () => {
      render(<Badge text={<strong>bold badge</strong>} />)
      expect(screen.getByText(/bold badge/i)).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should render with empty string text', () => {
      const { container } = render(<Badge text="" />)
      expect(container.firstChild).toBeInTheDocument()
      expect(container.firstChild).toHaveTextContent('')
    })

    it('should render with hasRedCornerMark false explicitly', () => {
      const { container } = render(<Badge text="test" hasRedCornerMark={false} />)
      const mark = container.querySelector('.bg-components-badge-status-light-error-bg')
      expect(mark).not.toBeInTheDocument()
    })
  })
})
