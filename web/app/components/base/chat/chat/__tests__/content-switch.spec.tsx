import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ContentSwitch from '../content-switch'

const defaultProps = {
  count: 3,
  currentIndex: 1,
  prevDisabled: false,
  nextDisabled: false,
  switchSibling: vi.fn(),
}

describe('ContentSwitch', () => {
  it.each([
    { count: 1, currentIndex: 0 },
    { count: 3, currentIndex: undefined },
  ])('stays hidden without multiple indexed answers', (props) => {
    const { container } = render(<ContentSwitch {...defaultProps} {...props} />)

    expect(container).toBeEmptyDOMElement()
  })

  it.each([
    ['Previous', 'prev'],
    ['Next', 'next'],
  ] as const)('switches to the %s answer', async (name, direction) => {
    const user = userEvent.setup()
    const switchSibling = vi.fn()
    render(<ContentSwitch {...defaultProps} switchSibling={switchSibling} />)

    await user.click(screen.getByRole('button', { name }))

    expect(switchSibling).toHaveBeenCalledWith(direction)
  })

  it.each([
    ['Previous', { prevDisabled: true }],
    ['Next', { nextDisabled: true }],
  ] as const)('disables unavailable %s navigation', async (name, disabledProp) => {
    const user = userEvent.setup()
    const switchSibling = vi.fn()
    render(<ContentSwitch {...defaultProps} {...disabledProp} switchSibling={switchSibling} />)

    const button = screen.getByRole('button', { name })
    expect(button).toBeDisabled()
    await user.click(button)
    expect(switchSibling).not.toHaveBeenCalled()
  })
})
