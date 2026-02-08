import { fireEvent, render, screen } from '@testing-library/react'
import { EffectColor } from './chunk-structure/types'
import OptionCard from './option-card'

// Note: react-i18next is globally mocked in vitest.setup.ts

describe('OptionCard', () => {
  const defaultProps = {
    id: 'test-id',
    title: 'Test Title',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<OptionCard {...defaultProps} />)
      expect(screen.getByText('Test Title')).toBeInTheDocument()
    })

    it('should render title', () => {
      render(<OptionCard {...defaultProps} title="Custom Title" />)
      expect(screen.getByText('Custom Title')).toBeInTheDocument()
    })

    it('should render description when provided', () => {
      render(<OptionCard {...defaultProps} description="Test Description" />)
      expect(screen.getByText('Test Description')).toBeInTheDocument()
    })

    it('should not render description when not provided', () => {
      render(<OptionCard {...defaultProps} />)
      expect(screen.queryByText(/description/i)).not.toBeInTheDocument()
    })

    it('should render icon when provided', () => {
      render(<OptionCard {...defaultProps} icon={<span data-testid="test-icon">Icon</span>} />)
      expect(screen.getByTestId('test-icon')).toBeInTheDocument()
    })

    it('should not render icon container when icon is not provided', () => {
      const { container } = render(<OptionCard {...defaultProps} />)
      const iconContainers = container.querySelectorAll('.size-6')
      expect(iconContainers).toHaveLength(0)
    })
  })

  describe('Active State', () => {
    it('should apply active styles when isActive is true', () => {
      const { container } = render(<OptionCard {...defaultProps} isActive={true} />)
      const card = container.firstChild
      expect(card).toHaveClass('ring-[1px]')
    })

    it('should not apply active styles when isActive is false', () => {
      const { container } = render(<OptionCard {...defaultProps} isActive={false} />)
      const card = container.firstChild
      expect(card).not.toHaveClass('ring-[1px]')
    })

    it('should apply iconActiveColor when isActive is true and icon is present', () => {
      const { container } = render(
        <OptionCard
          {...defaultProps}
          isActive={true}
          icon={<span>Icon</span>}
          iconActiveColor="text-red-500"
        />,
      )
      const iconContainer = container.querySelector('.text-red-500')
      expect(iconContainer).toBeInTheDocument()
    })
  })

  describe('Disabled State', () => {
    it('should apply disabled styles when disabled is true', () => {
      const { container } = render(<OptionCard {...defaultProps} disabled={true} />)
      const card = container.firstChild
      expect(card).toHaveClass('cursor-not-allowed')
      expect(card).toHaveClass('opacity-50')
    })

    it('should not call onClick when disabled', () => {
      const handleClick = vi.fn()
      render(<OptionCard {...defaultProps} disabled={true} onClick={handleClick} />)

      const card = screen.getByText('Test Title').closest('div')?.parentElement?.parentElement
      fireEvent.click(card!)

      expect(handleClick).not.toHaveBeenCalled()
    })

    it('should not call onClick when isActive', () => {
      const handleClick = vi.fn()
      render(<OptionCard {...defaultProps} isActive={true} onClick={handleClick} />)

      const card = screen.getByText('Test Title').closest('div')?.parentElement?.parentElement
      fireEvent.click(card!)

      expect(handleClick).not.toHaveBeenCalled()
    })
  })

  describe('Recommended Badge', () => {
    it('should render recommended badge when isRecommended is true', () => {
      render(<OptionCard {...defaultProps} isRecommended={true} />)
      // Badge uses translation key
      expect(screen.getByText(/stepTwo\.recommend/)).toBeInTheDocument()
    })

    it('should not render recommended badge when isRecommended is false', () => {
      render(<OptionCard {...defaultProps} isRecommended={false} />)
      expect(screen.queryByText(/stepTwo\.recommend/)).not.toBeInTheDocument()
    })
  })

  describe('Effect Color', () => {
    it('should render effect color when effectColor and showEffectColor are provided', () => {
      const { container } = render(
        <OptionCard {...defaultProps} effectColor={EffectColor.indigo} showEffectColor={true} />,
      )
      const effectElement = container.querySelector('.blur-\\[80px\\]')
      expect(effectElement).toBeInTheDocument()
    })

    it('should not render effect color when showEffectColor is false', () => {
      const { container } = render(
        <OptionCard {...defaultProps} effectColor={EffectColor.indigo} showEffectColor={false} />,
      )
      const effectElement = container.querySelector('.blur-\\[80px\\]')
      expect(effectElement).not.toBeInTheDocument()
    })

    it('should not render effect color when effectColor is not provided', () => {
      const { container } = render(
        <OptionCard {...defaultProps} showEffectColor={true} />,
      )
      const effectElement = container.querySelector('.blur-\\[80px\\]')
      expect(effectElement).not.toBeInTheDocument()
    })

    it('should apply indigo effect color class', () => {
      const { container } = render(
        <OptionCard {...defaultProps} effectColor={EffectColor.indigo} showEffectColor={true} />,
      )
      const effectElement = container.querySelector('.bg-util-colors-indigo-indigo-600')
      expect(effectElement).toBeInTheDocument()
    })

    it('should apply blueLight effect color class', () => {
      const { container } = render(
        <OptionCard {...defaultProps} effectColor={EffectColor.blueLight} showEffectColor={true} />,
      )
      const effectElement = container.querySelector('.bg-util-colors-blue-light-blue-light-600')
      expect(effectElement).toBeInTheDocument()
    })

    it('should apply orange effect color class', () => {
      const { container } = render(
        <OptionCard {...defaultProps} effectColor={EffectColor.orange} showEffectColor={true} />,
      )
      const effectElement = container.querySelector('.bg-util-colors-orange-orange-500')
      expect(effectElement).toBeInTheDocument()
    })

    it('should apply purple effect color class', () => {
      const { container } = render(
        <OptionCard {...defaultProps} effectColor={EffectColor.purple} showEffectColor={true} />,
      )
      const effectElement = container.querySelector('.bg-util-colors-purple-purple-600')
      expect(effectElement).toBeInTheDocument()
    })
  })

  describe('Children', () => {
    it('should render children when children and showChildren are provided', () => {
      render(
        <OptionCard {...defaultProps} showChildren={true}>
          <div data-testid="child-content">Child Content</div>
        </OptionCard>,
      )
      expect(screen.getByTestId('child-content')).toBeInTheDocument()
    })

    it('should not render children when showChildren is false', () => {
      render(
        <OptionCard {...defaultProps} showChildren={false}>
          <div data-testid="child-content">Child Content</div>
        </OptionCard>,
      )
      expect(screen.queryByTestId('child-content')).not.toBeInTheDocument()
    })

    it('should not render children container when children is not provided', () => {
      const { container } = render(
        <OptionCard {...defaultProps} showChildren={true} />,
      )
      const childContainer = container.querySelector('.bg-components-panel-bg')
      expect(childContainer).not.toBeInTheDocument()
    })

    it('should render arrow shape when children are shown', () => {
      const { container } = render(
        <OptionCard {...defaultProps} showChildren={true}>
          <div>Child</div>
        </OptionCard>,
      )
      // ArrowShape renders an SVG
      const childSection = container.querySelector('.bg-components-panel-bg')
      expect(childSection).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onClick with id when clicked', () => {
      const handleClick = vi.fn()
      render(<OptionCard {...defaultProps} id="my-id" onClick={handleClick} />)

      const card = screen.getByText('Test Title').closest('div')?.parentElement?.parentElement
      fireEvent.click(card!)

      expect(handleClick).toHaveBeenCalledWith('my-id')
    })

    it('should have cursor-pointer class', () => {
      const { container } = render(<OptionCard {...defaultProps} />)
      const card = container.firstChild
      expect(card).toHaveClass('cursor-pointer')
    })
  })

  describe('Props', () => {
    it('should apply custom className', () => {
      const { container } = render(<OptionCard {...defaultProps} className="custom-class" />)
      const innerContainer = container.querySelector('.custom-class')
      expect(innerContainer).toBeInTheDocument()
    })

    it('should forward ref', () => {
      const ref = vi.fn()
      render(<OptionCard {...defaultProps} ref={ref} />)
      expect(ref).toHaveBeenCalled()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty title', () => {
      render(<OptionCard {...defaultProps} title="" />)
      // Component should still render
      const { container } = render(<OptionCard {...defaultProps} title="" />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should handle complex id types', () => {
      const handleClick = vi.fn()
      const complexId = { key: 'value' }
      render(<OptionCard {...defaultProps} id={complexId} onClick={handleClick} />)

      const card = screen.getByText('Test Title').closest('div')?.parentElement?.parentElement
      fireEvent.click(card!)

      expect(handleClick).toHaveBeenCalledWith(complexId)
    })

    it('should handle numeric id', () => {
      const handleClick = vi.fn()
      render(<OptionCard {...defaultProps} id={123} onClick={handleClick} />)

      const card = screen.getByText('Test Title').closest('div')?.parentElement?.parentElement
      fireEvent.click(card!)

      expect(handleClick).toHaveBeenCalledWith(123)
    })

    it('should handle long title', () => {
      const longTitle = 'A'.repeat(200)
      render(<OptionCard {...defaultProps} title={longTitle} />)
      expect(screen.getByText(longTitle)).toBeInTheDocument()
    })

    it('should handle long description', () => {
      const longDesc = 'B'.repeat(500)
      render(<OptionCard {...defaultProps} description={longDesc} />)
      expect(screen.getByText(longDesc)).toBeInTheDocument()
    })

    it('should handle all props together', () => {
      const handleClick = vi.fn()
      render(
        <OptionCard
          id="full-test"
          title="Full Test"
          description="Full Description"
          icon={<span data-testid="full-icon">Icon</span>}
          iconActiveColor="text-blue-500"
          isActive={true}
          isRecommended={true}
          effectColor={EffectColor.indigo}
          showEffectColor={true}
          disabled={false}
          onClick={handleClick}
          className="full-class"
          showChildren={true}
        >
          <div data-testid="full-children">Children</div>
        </OptionCard>,
      )

      expect(screen.getByText('Full Test')).toBeInTheDocument()
      expect(screen.getByText('Full Description')).toBeInTheDocument()
      expect(screen.getByTestId('full-icon')).toBeInTheDocument()
      expect(screen.getByTestId('full-children')).toBeInTheDocument()
    })
  })
})
