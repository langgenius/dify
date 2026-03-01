import { render, screen } from '@testing-library/react'
import Placeholder from './placeholder'

describe('Placeholder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render translated default placeholder text when value is not provided', () => {
      render(<Placeholder />)

      expect(screen.getByText('common.promptEditor.placeholder')).toBeInTheDocument()
    })

    it('should render provided value instead of translated default text', () => {
      render(<Placeholder value={<span>custom placeholder</span>} />)

      expect(screen.getByText('custom placeholder')).toBeInTheDocument()
      expect(screen.queryByText('common.promptEditor.placeholder')).not.toBeInTheDocument()
    })
  })

  describe('Class names', () => {
    it('should apply compact text classes when compact is true', () => {
      const { container } = render(<Placeholder compact />)
      const wrapper = container.firstElementChild

      expect(wrapper).toHaveClass('text-[13px]')
      expect(wrapper).toHaveClass('leading-5')
      expect(wrapper).not.toHaveClass('leading-6')
    })

    it('should apply default text classes when compact is false', () => {
      const { container } = render(<Placeholder compact={false} />)
      const wrapper = container.firstElementChild

      expect(wrapper).toHaveClass('text-sm')
      expect(wrapper).toHaveClass('leading-6')
      expect(wrapper).not.toHaveClass('leading-5')
    })

    it('should merge additional className when provided', () => {
      const { container } = render(<Placeholder className="custom-class" />)
      const wrapper = container.firstElementChild

      expect(wrapper).toHaveClass('custom-class')
    })
  })
})
