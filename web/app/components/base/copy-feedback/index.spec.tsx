import { fireEvent, render, screen } from '@testing-library/react'
import CopyFeedback, { CopyFeedbackNew } from '.'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/app/components/base/tooltip', () => ({
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

describe('copy feedback component', () => {
  it('renders normally', () => {
    const { container } = render(<CopyFeedback content="this is some test content for the copy feedback component" />)
    expect(screen.getByTestId('tooltip-mock'))
    expect(container.querySelector('.action-btn')).not.toBeNull()
  })

  it('copy button works', () => {
    const { container } = render(<CopyFeedback content="this is some test content for the copy feedback component" />)
    const button = container.querySelector('.action-btn') as HTMLElement
    fireEvent.click(button.firstChild as Element)
    expect(copy).toBeCalledTimes(1)
  })

  it('reset functionality works', () => {
    const { container } = render(<CopyFeedback content="this is some test content for the copy feedback component" />)
    const button = container.querySelector('.action-btn') as HTMLElement
    fireEvent.mouseLeave(button.firstChild as Element)
    expect(reset).toBeCalledTimes(1)
  })

  it('icon appears initially', () => {
    const { container } = render(<CopyFeedback content="this is some test content for the copy feedback component" />)
    const svg = container.querySelector('svg') as SVGSVGElement
    expect(svg).not.toBeNull()
  })

  it('icon appears on copied', () => {
    copied = true
    const { container } = render(<CopyFeedback content="this is some test content for the copy feedback component" />)
    const svg = container.querySelector('svg') as SVGSVGElement
    expect(svg).not.toBeNull()
  })
})

describe('copy feedback new component', () => {
  beforeEach(() => {
    copied = false
  })

  it('renders normally', () => {
    const { container } = render(<CopyFeedbackNew content="this is some test content for the copy feedback component" />)
    expect(screen.getByTestId('tooltip-mock'))
    expect(container.querySelector('.cursor-pointer')).not.toBeNull()
  })

  it('copy button works', () => {
    const { container } = render(<CopyFeedbackNew content="this is some test content for the copy feedback component" />)
    const button = container.querySelector('.cursor-pointer') as HTMLElement
    fireEvent.click(button.firstChild as Element)
    expect(copy).toBeCalledTimes(1)
  })

  it('reset functionality works', () => {
    const { container } = render(<CopyFeedbackNew content="this is some test content for the copy feedback component" />)
    const button = container.querySelector('.cursor-pointer') as HTMLElement
    fireEvent.mouseLeave(button.firstChild as Element)
    expect(reset).toBeCalledTimes(1)
  })

  it('copied style renders', () => {
    copied = true
    const { container } = render(<CopyFeedbackNew content="this is some test content for the copy feedback component" />)
    expect(container.querySelector('._copied_eb3d8b')).not.toBeNull()
  })

  it('copy style renders', () => {
    const { container } = render(<CopyFeedbackNew content="this is some test content for the copy feedback component" />)
    expect(container.querySelector('._copied_eb3d8b')).toBeNull()
  })
})
