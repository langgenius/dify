import { fireEvent, render, screen } from '@testing-library/react'
import AppIcon from './index'

// Mock emoji-mart initialization
vi.mock('emoji-mart', () => ({
  init: vi.fn(),
}))

// Mock emoji data
vi.mock('@emoji-mart/data', () => ({
  default: {},
}))

// Create a controllable mock for useHover
let mockHoverValue = false
vi.mock('ahooks', () => ({
  useHover: vi.fn(() => mockHoverValue),
}))

describe('AppIcon', () => {
  beforeEach(() => {
    // Mock custom element
    if (!customElements.get('em-emoji')) {
      customElements.define('em-emoji', class extends HTMLElement {
        constructor() {
          super()
        }

        // Mock basic functionality
        connectedCallback() {
          this.innerHTML = '🤖'
        }
      })
    }

    // Reset mock hover value
    mockHoverValue = false
  })

  it('renders default emoji when no icon or image is provided', () => {
    render(<AppIcon />)
    const emojiElement = document.querySelector('em-emoji')
    expect(emojiElement).toBeInTheDocument()
    expect(emojiElement?.getAttribute('id')).toBe('🤖')
  })

  it('renders with custom emoji when icon is provided', () => {
    render(<AppIcon icon="smile" />)
    const emojiElement = document.querySelector('em-emoji')
    expect(emojiElement).toBeInTheDocument()
    expect(emojiElement?.getAttribute('id')).toBe('smile')
  })

  it('renders image when iconType is image and imageUrl is provided', () => {
    render(<AppIcon iconType="image" imageUrl="test-image.jpg" />)
    const imgElement = screen.getByAltText('app icon')
    expect(imgElement).toBeInTheDocument()
    expect(imgElement).toHaveAttribute('src', 'test-image.jpg')
  })

  it('renders innerIcon when provided', () => {
    render(<AppIcon innerIcon={<div data-testid="inner-icon">Custom Icon</div>} />)
    const innerIcon = screen.getByTestId('inner-icon')
    expect(innerIcon).toBeInTheDocument()
  })

  it('applies size classes correctly', () => {
    const { container: xsContainer } = render(<AppIcon size="xs" />)
    expect(xsContainer.firstChild).toHaveClass('w-4 h-4 rounded-[4px]')

    const { container: tinyContainer } = render(<AppIcon size="tiny" />)
    expect(tinyContainer.firstChild).toHaveClass('w-6 h-6 rounded-md')

    const { container: smallContainer } = render(<AppIcon size="small" />)
    expect(smallContainer.firstChild).toHaveClass('w-8 h-8 rounded-lg')

    const { container: mediumContainer } = render(<AppIcon size="medium" />)
    expect(mediumContainer.firstChild).toHaveClass('w-9 h-9 rounded-[10px]')

    const { container: largeContainer } = render(<AppIcon size="large" />)
    expect(largeContainer.firstChild).toHaveClass('w-10 h-10 rounded-[10px]')

    const { container: xlContainer } = render(<AppIcon size="xl" />)
    expect(xlContainer.firstChild).toHaveClass('w-12 h-12 rounded-xl')

    const { container: xxlContainer } = render(<AppIcon size="xxl" />)
    expect(xxlContainer.firstChild).toHaveClass('w-14 h-14 rounded-2xl')
  })

  it('applies rounded class when rounded=true', () => {
    const { container } = render(<AppIcon rounded />)
    expect(container.firstChild).toHaveClass('rounded-full')
  })

  it('applies custom background color', () => {
    const { container } = render(<AppIcon background="#FF5500" />)
    expect(container.firstChild).toHaveStyle('background: #FF5500')
  })

  it('uses default background color when no background is provided for non-image icons', () => {
    const { container } = render(<AppIcon />)
    expect(container.firstChild).toHaveStyle('background: #FFEAD5')
  })

  it('does not apply background style for image icons', () => {
    const { container } = render(<AppIcon iconType="image" imageUrl="test.jpg" background="#FF5500" />)
    // Should not have the background style from the prop
    expect(container.firstChild).not.toHaveStyle('background: #FF5500')
  })

  it('calls onClick handler when clicked', () => {
    const handleClick = vi.fn()
    const { container } = render(<AppIcon onClick={handleClick} />)
    fireEvent.click(container.firstChild!)

    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('applies custom className', () => {
    const { container } = render(<AppIcon className="custom-class" />)
    expect(container.firstChild).toHaveClass('custom-class')
  })

  it('does not display edit icon when showEditIcon=false', () => {
    render(<AppIcon />)
    const editIcon = screen.queryByRole('svg')
    expect(editIcon).not.toBeInTheDocument()
  })

  it('displays edit icon when showEditIcon=true and hovering', () => {
    // Mock the useHover hook to return true for this test
    mockHoverValue = true

    render(<AppIcon showEditIcon />)
    const editIcon = document.querySelector('svg')
    expect(editIcon).toBeInTheDocument()
  })

  it('does not display edit icon when showEditIcon=true but not hovering', () => {
    // useHover returns false by default from our mock setup
    mockHoverValue = false
    render(<AppIcon showEditIcon />)
    const editIcon = document.querySelector('svg')
    expect(editIcon).not.toBeInTheDocument()
  })

  it('handles conditional isValidImageIcon check correctly', () => {
    // Case 1: Valid image icon
    const { rerender } = render(
      <AppIcon iconType="image" imageUrl="test.jpg" />,
    )
    expect(screen.getByAltText('app icon')).toBeInTheDocument()

    // Case 2: Invalid - missing image URL
    rerender(<AppIcon iconType="image" imageUrl={null} />)
    expect(screen.queryByAltText('app icon')).not.toBeInTheDocument()

    // Case 3: Invalid - wrong icon type
    rerender(<AppIcon iconType="emoji" imageUrl="test.jpg" />)
    expect(screen.queryByAltText('app icon')).not.toBeInTheDocument()
  })
})
