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

    await user.click(screen.getByRole('button', { name: 'common.operation.copy' }))

    expect(mockCopy).toHaveBeenCalledWith('test content')
  })

  it('announces the copied state through the action name', () => {
    mockCopied = true

    render(<CopyFeedback content="test content" />)

    expect(screen.getByRole('button', { name: 'common.operation.copied' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('common.operation.copied')
  })

  it('only announces success after the clipboard reports success', () => {
    const { rerender } = render(<CopyFeedback content="test content" copiedLabel="URL copied" />)
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    mockCopied = true
    rerender(<CopyFeedback content="test content" copiedLabel="URL copied" />)
    expect(screen.getByRole('status')).toHaveTextContent('URL copied')
    mockCopied = false
    rerender(<CopyFeedback content="test content" copiedLabel="URL copied" />)
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })
})
