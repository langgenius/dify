import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CopyFeedback } from '..'

const mockCopy = vi.fn()
let mockCopied = false

vi.mock('foxact/use-clipboard', () => ({
  useClipboard: () => ({
    copy: mockCopy,
    copied: mockCopied,
  }),
}))

describe('CopyFeedback', () => {
  beforeEach(() => {
    mockCopied = false
    vi.clearAllMocks()
  })

  it('copies the supplied content from the accessible action', async () => {
    const user = userEvent.setup()
    render(<CopyFeedback content="test content" />)

    await user.click(
      screen.getByRole('button', { name: 'appOverview.overview.appInfo.embedded.copy' }),
    )

    expect(mockCopy).toHaveBeenCalledWith('test content')
  })

  it('announces the copied state through the action name', () => {
    mockCopied = true

    render(<CopyFeedback content="test content" />)

    expect(
      screen.getByRole('button', { name: 'appOverview.overview.appInfo.embedded.copied' }),
    ).toBeInTheDocument()
  })
})
