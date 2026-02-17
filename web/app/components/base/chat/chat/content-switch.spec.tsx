import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
    const { container } = render(<ContentSwitch {...defaultProps} count={1} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when currentIndex is undefined', () => {
    const { container } = render(<ContentSwitch {...defaultProps} currentIndex={undefined} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders correctly with current page and total count', () => {
    render(<ContentSwitch {...defaultProps} currentIndex={0} count={5} />)
    expect(screen.getByText(/1[^\n\r/\u2028\u2029]*\/.*5/)).toBeInTheDocument()
  })

  it('calls switchSibling with "prev" when left button is clicked', async () => {
    const user = userEvent.setup()
    const switchSibling = vi.fn()
    render(<ContentSwitch {...defaultProps} switchSibling={switchSibling} />)

    const prevButton = screen.getByRole('button', { name: /previous/i })
    await user.click(prevButton)

    expect(switchSibling).toHaveBeenCalledWith('prev')
  })

  it('calls switchSibling with "next" when right button is clicked', async () => {
    const user = userEvent.setup()
    const switchSibling = vi.fn()
    render(<ContentSwitch {...defaultProps} switchSibling={switchSibling} />)

    const nextButton = screen.getByRole('button', { name: /next/i })
    await user.click(nextButton)

    expect(switchSibling).toHaveBeenCalledWith('next')
  })

  it('applies disabled styles and prevents clicks when prevDisabled is true', async () => {
    const user = userEvent.setup()
    const switchSibling = vi.fn()
    render(<ContentSwitch {...defaultProps} prevDisabled={true} switchSibling={switchSibling} />)

    const prevButton = screen.getByRole('button', { name: /previous/i })

    expect(prevButton).toHaveClass('opacity-30')
    expect(prevButton).toBeDisabled()

    await user.click(prevButton)
    expect(switchSibling).not.toHaveBeenCalled()
  })

  it('applies disabled styles and prevents clicks when nextDisabled is true', async () => {
    const user = userEvent.setup()
    const switchSibling = vi.fn()
    render(<ContentSwitch {...defaultProps} nextDisabled={true} switchSibling={switchSibling} />)

    const nextButton = screen.getByRole('button', { name: /next/i })

    expect(nextButton).toHaveClass('opacity-30')
    expect(nextButton).toBeDisabled()

    await user.click(nextButton)
    expect(switchSibling).not.toHaveBeenCalled()
  })
})
