import { render, screen } from '@testing-library/react'
import Header from './header'

describe('TimePicker Header', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests
  describe('Rendering', () => {
    it('should render default title when no title prop is provided', () => {
      render(<Header />)

      // Global i18n mock returns the key with namespace prefix
      expect(screen.getByText(/title\.pickTime/)).toBeInTheDocument()
    })

    it('should render custom title when title prop is provided', () => {
      render(<Header title="Custom Title" />)

      expect(screen.getByText('Custom Title')).toBeInTheDocument()
    })

    it('should not render default title when custom title is provided', () => {
      render(<Header title="Custom Title" />)

      expect(screen.queryByText(/title\.pickTime/)).not.toBeInTheDocument()
    })
  })
})
