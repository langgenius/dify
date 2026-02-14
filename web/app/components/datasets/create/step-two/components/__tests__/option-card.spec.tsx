import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OptionCard, OptionCardHeader } from '../option-card'

// Override global next/image auto-mock: tests assert on rendered <img> elements
vi.mock('next/image', () => ({
  default: ({ src, alt, ...props }: { src?: string, alt?: string, width?: number, height?: number }) => (
    <img src={src} alt={alt} {...props} />
  ),
}))

describe('OptionCardHeader', () => {
  const defaultProps = {
    icon: <span data-testid="icon">icon</span>,
    title: <span>Test Title</span>,
    description: 'Test description',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render icon, title and description', () => {
    render(<OptionCardHeader {...defaultProps} />)
    expect(screen.getByTestId('icon')).toBeInTheDocument()
    expect(screen.getByText('Test Title')).toBeInTheDocument()
    expect(screen.getByText('Test description')).toBeInTheDocument()
  })

  it('should show effect image when active and effectImg provided', () => {
    const { container } = render(
      <OptionCardHeader {...defaultProps} isActive effectImg="/effect.png" />,
    )
    const img = container.querySelector('img')
    expect(img).toBeInTheDocument()
  })

  it('should not show effect image when not active', () => {
    const { container } = render(
      <OptionCardHeader {...defaultProps} isActive={false} effectImg="/effect.png" />,
    )
    expect(container.querySelector('img')).not.toBeInTheDocument()
  })

  it('should apply cursor-pointer when not disabled', () => {
    const { container } = render(<OptionCardHeader {...defaultProps} />)
    expect(container.firstChild).toHaveClass('cursor-pointer')
  })

  it('should not apply cursor-pointer when disabled', () => {
    const { container } = render(<OptionCardHeader {...defaultProps} disabled />)
    expect(container.firstChild).not.toHaveClass('cursor-pointer')
  })

  it('should apply activeClassName when active', () => {
    const { container } = render(
      <OptionCardHeader {...defaultProps} isActive activeClassName="custom-active" />,
    )
    expect(container.firstChild).toHaveClass('custom-active')
  })

  it('should not apply activeClassName when not active', () => {
    const { container } = render(
      <OptionCardHeader {...defaultProps} isActive={false} activeClassName="custom-active" />,
    )
    expect(container.firstChild).not.toHaveClass('custom-active')
  })
})

describe('OptionCard', () => {
  const defaultProps = {
    icon: <span data-testid="icon">icon</span>,
    title: <span>Card Title</span> as React.ReactNode,
    description: 'Card description',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render header content', () => {
    render(<OptionCard {...defaultProps} />)
    expect(screen.getByText('Card Title')).toBeInTheDocument()
    expect(screen.getByText('Card description')).toBeInTheDocument()
  })

  it('should call onSwitched when clicked while not active and not disabled', () => {
    const onSwitched = vi.fn()
    const { container } = render(
      <OptionCard {...defaultProps} isActive={false} onSwitched={onSwitched} />,
    )
    fireEvent.click(container.firstChild!)
    expect(onSwitched).toHaveBeenCalledOnce()
  })

  it('should not call onSwitched when already active', () => {
    const onSwitched = vi.fn()
    const { container } = render(
      <OptionCard {...defaultProps} isActive onSwitched={onSwitched} />,
    )
    fireEvent.click(container.firstChild!)
    expect(onSwitched).not.toHaveBeenCalled()
  })

  it('should not call onSwitched when disabled', () => {
    const onSwitched = vi.fn()
    const { container } = render(
      <OptionCard {...defaultProps} disabled onSwitched={onSwitched} />,
    )
    fireEvent.click(container.firstChild!)
    expect(onSwitched).not.toHaveBeenCalled()
  })

  it('should show children and actions when active', () => {
    render(
      <OptionCard {...defaultProps} isActive actions={<button>Action</button>}>
        <div>Body Content</div>
      </OptionCard>,
    )
    expect(screen.getByText('Body Content')).toBeInTheDocument()
    expect(screen.getByText('Action')).toBeInTheDocument()
  })

  it('should not show children when not active', () => {
    render(
      <OptionCard {...defaultProps} isActive={false}>
        <div>Body Content</div>
      </OptionCard>,
    )
    expect(screen.queryByText('Body Content')).not.toBeInTheDocument()
  })

  it('should apply selected border style when active and not noHighlight', () => {
    const { container } = render(<OptionCard {...defaultProps} isActive />)
    expect(container.firstChild).toHaveClass('border-components-option-card-option-selected-border')
  })

  it('should not apply selected border when noHighlight is true', () => {
    const { container } = render(<OptionCard {...defaultProps} isActive noHighlight />)
    expect(container.firstChild).not.toHaveClass('border-components-option-card-option-selected-border')
  })

  it('should apply disabled opacity and pointer-events styles', () => {
    const { container } = render(<OptionCard {...defaultProps} disabled />)
    expect(container.firstChild).toHaveClass('pointer-events-none')
    expect(container.firstChild).toHaveClass('opacity-50')
  })

  it('should forward custom className', () => {
    const { container } = render(<OptionCard {...defaultProps} className="custom-class" />)
    expect(container.firstChild).toHaveClass('custom-class')
  })

  it('should forward custom style', () => {
    const { container } = render(
      <OptionCard {...defaultProps} style={{ maxWidth: '300px' }} />,
    )
    expect((container.firstChild as HTMLElement).style.maxWidth).toBe('300px')
  })
})
