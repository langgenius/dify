import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SnippetDetailTop } from '../snippet-detail-top'

const back = vi.fn()
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ back }),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

it('keeps browser history separate from the home and snippet collection destinations', async () => {
  const user = userEvent.setup()
  render(<SnippetDetailTop />)
  const path = within(screen.getByRole('navigation', { name: 'workflow.tabs.snippets' }))
  expect(path.getAllByRole('listitem')).toHaveLength(2)
  expect(path.getByRole('link', { name: 'common.mainNav.home' })).toHaveAttribute('href', '/')
  const collection = path.getByRole('link', { name: 'workflow.tabs.snippets' })
  expect(collection).toHaveAttribute('href', '/snippets')
  expect(collection).not.toHaveAttribute('aria-current')

  const previous = path.getByRole('button', { name: 'common.operation.back' })
  previous.focus()
  await user.keyboard('{Enter}')
  expect(back).toHaveBeenCalledOnce()
})

it('removes the path when collapsed while retaining the expand control', async () => {
  const user = userEvent.setup()
  const onToggle = vi.fn()
  const { rerender } = render(<SnippetDetailTop onToggle={onToggle} />)
  rerender(<SnippetDetailTop expand={false} onToggle={onToggle} />)
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'layout.sidebar.expandSidebar' }))
  expect(onToggle).toHaveBeenCalledOnce()
})
