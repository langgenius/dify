import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ContentSwitch from './content-switch'

describe('ContentSwitch', () => {
  const defaultProps = {
    count: 3,
    currentIndex: 1,
    prevDisabled: false,
    nextDisabled: false,
    switchSibling: vi.fn(),
  }

  it('renders nothing when count is 1 or less', () => {
    const { container } = render(
      <ContentSwitch {...defaultProps} count={1} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when currentIndex is undefined', () => {
    const { container } = render(
      <ContentSwitch {...defaultProps} currentIndex={undefined} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders correctly with current page and total count', () => {
    render(<ContentSwitch {...defaultProps} currentIndex={0} count={5} />)

    // The /i makes it case insensitive, the dots handle the spaces/line breaks
    expect(screen.getByText(/1[^\n\r/\u2028\u2029]*\/.*5/)).toBeInTheDocument()
  })
  it('calls switchSibling with "prev" when left button is clicked', () => {
    const switchSibling = vi.fn()
    render(<ContentSwitch {...defaultProps} switchSibling={switchSibling} />)

    const prevButton = screen.getAllByRole('button')[0]
    fireEvent.click(prevButton)

    expect(switchSibling).toHaveBeenCalledWith('prev')
  })

  it('calls switchSibling with "next" when right button is clicked', () => {
    const switchSibling = vi.fn()
    render(<ContentSwitch {...defaultProps} switchSibling={switchSibling} />)

    const nextButton = screen.getAllByRole('button')[1]
    fireEvent.click(nextButton)

    expect(switchSibling).toHaveBeenCalledWith('next')
  })

  it('applies disabled styles and prevents clicks when prevDisabled is true', () => {
    const switchSibling = vi.fn()
    render(<ContentSwitch {...defaultProps} prevDisabled={true} switchSibling={switchSibling} />)

    const prevButton = screen.getAllByRole('button')[0]

    // Check for the opacity class
    expect(prevButton).toHaveClass('opacity-30')
    expect(prevButton).toBeDisabled()

    fireEvent.click(prevButton)
    expect(switchSibling).not.toHaveBeenCalled()
  })

  it('applies disabled styles and prevents clicks when nextDisabled is true', () => {
    const switchSibling = vi.fn()
    render(<ContentSwitch {...defaultProps} nextDisabled={true} switchSibling={switchSibling} />)

    const nextButton = screen.getAllByRole('button')[1]

    expect(nextButton).toHaveClass('opacity-30')
    expect(nextButton).toBeDisabled()

    fireEvent.click(nextButton)
    expect(switchSibling).not.toHaveBeenCalled()
  })
})
