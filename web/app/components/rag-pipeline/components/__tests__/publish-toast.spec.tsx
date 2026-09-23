import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PublishToast from '../publish-toast'

let mockPublishedAt = 0
vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: { publishedAt: number }) => unknown) =>
    selector({ publishedAt: mockPublishedAt }),
}))

describe('PublishToast', () => {
  beforeEach(() => {
    mockPublishedAt = 0
  })

  it('does not show the unpublished notice for a published pipeline', () => {
    mockPublishedAt = 1
    render(<PublishToast />)
    expect(screen.queryByText('pipeline.publishToast.title')).not.toBeInTheDocument()
  })

  it('allows keyboard users to dismiss the notice and keeps it dismissed on rerender', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<PublishToast />)
    expect(screen.getByText('pipeline.publishToast.desc')).toBeInTheDocument()
    await user.tab()
    expect(screen.getByRole('button', { name: 'common.operation.close' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.queryByText('pipeline.publishToast.title')).not.toBeInTheDocument()
    rerender(<PublishToast />)
    expect(screen.queryByText('pipeline.publishToast.title')).not.toBeInTheDocument()
  })
})
