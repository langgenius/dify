import { fireEvent, render, screen } from '@testing-library/react'
import AutomaticBtn from './automatic-btn'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

describe('AutomaticBtn', () => {
  const mockOnClick = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render the button with correct text', () => {
      render(<AutomaticBtn onClick={mockOnClick} />)

      expect(screen.getByText('operation.automatic')).toBeInTheDocument()
    })

    it('should render the sparkling icon', () => {
      const { container } = render(<AutomaticBtn onClick={mockOnClick} />)

      // The icon should be an SVG element inside the button
      const svg = container.querySelector('svg')
      expect(svg).toBeTruthy()
    })

    it('should render as a button element', () => {
      render(<AutomaticBtn onClick={mockOnClick} />)

      expect(screen.getByRole('button')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onClick when button is clicked', () => {
      render(<AutomaticBtn onClick={mockOnClick} />)

      const button = screen.getByRole('button')
      fireEvent.click(button)

      expect(mockOnClick).toHaveBeenCalledTimes(1)
    })

    it('should call onClick multiple times on multiple clicks', () => {
      render(<AutomaticBtn onClick={mockOnClick} />)

      const button = screen.getByRole('button')

      fireEvent.click(button)
      fireEvent.click(button)
      fireEvent.click(button)

      expect(mockOnClick).toHaveBeenCalledTimes(3)
    })
  })

  describe('Styling', () => {
    it('should have secondary-accent variant', () => {
      render(<AutomaticBtn onClick={mockOnClick} />)

      const button = screen.getByRole('button')
      expect(button.className).toContain('secondary-accent')
    })

    it('should have small size', () => {
      render(<AutomaticBtn onClick={mockOnClick} />)

      const button = screen.getByRole('button')
      expect(button.className).toContain('small')
    })
  })
})
