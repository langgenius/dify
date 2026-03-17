import { fireEvent, render, screen } from '@testing-library/react'
import CopyIcon from '..'

const copy = vi.fn()
const reset = vi.fn()
let copied = false

vi.mock('foxact/use-clipboard', () => ({
  useClipboard: () => ({
    copy,
    reset,
    copied,
  }),
}))

describe('copy icon component', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    copied = false
  })

  it('renders normally', () => {
    render(<CopyIcon content="this is some test content for the copy icon component" />)
    const icon = screen.getByTestId('copy-icon')
    expect(icon).toBeInTheDocument()
  })

  it('shows copy check icon when copied', () => {
    copied = true
    render(<CopyIcon content="this is some test content for the copy icon component" />)
    const icon = screen.getByTestId('copied-icon')
    expect(icon).toBeInTheDocument()
  })

  it('handles copy when clicked', () => {
    render(<CopyIcon content="this is some test content for the copy icon component" />)
    const icon = screen.getByTestId('copy-icon')
    fireEvent.click(icon as Element)
    expect(copy).toBeCalledTimes(1)
  })

  it('resets on mouse leave', () => {
    render(<CopyIcon content="this is some test content for the copy icon component" />)
    const icon = screen.getByTestId('copy-icon')
    const div = icon?.parentElement as HTMLElement
    fireEvent.mouseLeave(div)
    expect(reset).toBeCalledTimes(1)
  })
})
