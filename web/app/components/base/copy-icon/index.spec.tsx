import { fireEvent, render } from '@testing-library/react'
import CopyIcon from '.'

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
    const { container } = render(<CopyIcon content="this is some test content for the copy icon component" />)
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('shows copy icon initially', () => {
    const { container } = render(<CopyIcon content="this is some test content for the copy icon component" />)
    const icon = container.querySelector('[data-icon="Copy"]')
    expect(icon).toBeInTheDocument()
  })

  it('shows copy check icon when copied', () => {
    copied = true
    const { container } = render(<CopyIcon content="this is some test content for the copy icon component" />)
    const icon = container.querySelector('[data-icon="CopyCheck"]')
    expect(icon).toBeInTheDocument()
  })

  it('handles copy when clicked', () => {
    const { container } = render(<CopyIcon content="this is some test content for the copy icon component" />)
    const icon = container.querySelector('[data-icon="Copy"]')
    fireEvent.click(icon as Element)
    expect(copy).toBeCalledTimes(1)
  })

  it('resets on mouse leave', () => {
    const { container } = render(<CopyIcon content="this is some test content for the copy icon component" />)
    const icon = container.querySelector('[data-icon="Copy"]')
    const div = icon?.parentElement as HTMLElement
    fireEvent.mouseLeave(div)
    expect(reset).toBeCalledTimes(1)
  })
})
