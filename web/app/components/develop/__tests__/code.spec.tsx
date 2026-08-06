import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { writeTextToClipboard } from '@/utils/clipboard'
import { CodeGroup } from '../code'

vi.mock('@/utils/clipboard', () => ({
  writeTextToClipboard: vi.fn().mockResolvedValue(undefined),
}))

describe('CodeGroup', () => {
  beforeEach(() => {
    window.scrollBy = vi.fn()
  })

  it('switches between named code examples', async () => {
    const user = userEvent.setup()
    render(
      <CodeGroup
        targetCode={[
          { title: 'JavaScript', code: 'console.log("js")' },
          { title: 'Python', code: 'print("py")' },
        ]}
      />,
    )

    expect(screen.getByText('console.log("js")')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Python' }))

    expect(screen.getByText('print("py")')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Python' })).toHaveAttribute('aria-selected', 'true')
  })

  it('copies the displayed code', async () => {
    const user = userEvent.setup()
    render(<CodeGroup targetCode="code to copy" />)

    await user.click(screen.getByRole('button', { name: 'Copy' }))

    expect(writeTextToClipboard).toHaveBeenCalledWith('code to copy')
    expect(await screen.findByRole('button', { name: 'Copied!' })).toBeInTheDocument()
  })

  it('renders authored code content when targetCode is omitted', () => {
    render(
      <CodeGroup>
        <pre>
          <code>child code content</code>
        </pre>
      </CodeGroup>,
    )

    expect(screen.getByText('child code content')).toBeInTheDocument()
  })
})
