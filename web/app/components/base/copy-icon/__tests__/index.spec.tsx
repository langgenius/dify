import { fireEvent, render, screen } from '@testing-library/react'
import CopyIcon from '..'

const copy = vi.fn()
const reset = vi.fn()
let copied = false

vi.mock('@/hooks/use-clipboard', () => ({
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
    expect(screen.getByRole('button', { name: 'appOverview.overview.appInfo.embedded.copy' })).toBeInTheDocument()
  })

  it('shows copy check icon when copied', () => {
    copied = true
    render(<CopyIcon content="this is some test content for the copy icon component" />)
    expect(screen.getByRole('button', { name: 'appOverview.overview.appInfo.embedded.copied' })).toBeInTheDocument()
  })

  it('handles copy when clicked', () => {
    render(<CopyIcon content="this is some test content for the copy icon component" />)
    fireEvent.click(screen.getByRole('button', { name: 'appOverview.overview.appInfo.embedded.copy' }))
    expect(copy).toBeCalledTimes(1)
  })

  it('resets on mouse leave', () => {
    render(<CopyIcon content="this is some test content for the copy icon component" />)
    fireEvent.mouseLeave(screen.getByRole('button', { name: 'appOverview.overview.appInfo.embedded.copy' }))
    expect(reset).toBeCalledTimes(1)
  })
})
