import { render, screen } from '@testing-library/react'
import AppUnavailable from './app-unavailable'

describe('AppUnavailable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<AppUnavailable />)
      expect(screen.getByText(/404/)).toBeInTheDocument()
    })

    it('should render the error code in a heading', () => {
      render(<AppUnavailable />)
      const heading = screen.getByRole('heading', { level: 1 })
      expect(heading).toHaveTextContent(/404/)
    })

    it('should render the default unavailable message', () => {
      render(<AppUnavailable />)
      expect(screen.getByText(/unavailable/i)).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should display custom error code', () => {
      render(<AppUnavailable code={500} />)
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('500')
    })

    it('should accept string error code', () => {
      render(<AppUnavailable code="403" />)
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('403')
    })

    it('should apply custom className', () => {
      const { container } = render(<AppUnavailable className="my-custom" />)
      const outerDiv = container.firstChild as HTMLElement
      expect(outerDiv).toHaveClass('my-custom')
    })

    it('should retain base classes when custom className is applied', () => {
      const { container } = render(<AppUnavailable className="my-custom" />)
      const outerDiv = container.firstChild as HTMLElement
      expect(outerDiv).toHaveClass('flex', 'h-screen', 'w-screen', 'items-center', 'justify-center')
    })

    it('should display unknownReason when provided', () => {
      render(<AppUnavailable unknownReason="Custom error occurred" />)
      expect(screen.getByText(/Custom error occurred/i)).toBeInTheDocument()
    })

    it('should display unknown error translation when isUnknownReason is true', () => {
      render(<AppUnavailable isUnknownReason />)
      expect(screen.getByText(/share.common.appUnknownError/i)).toBeInTheDocument()
    })

    it('should prioritize unknownReason over isUnknownReason', () => {
      render(<AppUnavailable isUnknownReason unknownReason="My custom reason" />)
      expect(screen.getByText(/My custom reason/i)).toBeInTheDocument()
    })

    it('should show appUnavailable translation when isUnknownReason is false', () => {
      render(<AppUnavailable isUnknownReason={false} />)
      expect(screen.getByText(/share.common.appUnavailable/i)).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should render with code 0', () => {
      render(<AppUnavailable code={0} />)
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('0')
    })

    it('should render with an empty unknownReason and fall back to translation', () => {
      render(<AppUnavailable unknownReason="" />)
      expect(screen.getByText(/share.common.appUnavailable/i)).toBeInTheDocument()
    })
  })
})
