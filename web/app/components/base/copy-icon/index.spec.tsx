import { fireEvent, render, screen } from '@testing-library/react'
import CopyIcon from '.'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('../tooltip', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-mock">{children}</div>
  ),
}))

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
    expect(screen.getByTestId('tooltip-mock'))
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
    render(<CopyIcon content="this is some test content for the copy icon component" />)
    const tooltip = screen.getByTestId('tooltip-mock') as HTMLElement
    const div = tooltip.firstChild as HTMLElement
    fireEvent.mouseLeave(div as Element)
    expect(reset).toBeCalledTimes(1)
  })
})
