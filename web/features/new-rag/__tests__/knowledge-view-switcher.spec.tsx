import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { KnowledgeViewSwitcher } from '../components/knowledge-view-switcher'

const guideStorageMock = vi.hoisted(() => ({
  dismissed: false,
  setDismissed: vi.fn(),
}))

vi.mock('@/features/new-rag/storage', () => ({
  useNewKnowledgeGuideDismissedValue: () => guideStorageMock.dismissed,
  useSetNewKnowledgeGuideDismissed: () => guideStorageMock.setDismissed,
}))

describe('KnowledgeViewSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    guideStorageMock.dismissed = false
  })

  it('restores focus to the guide trigger when Escape closes the popover', async () => {
    const user = userEvent.setup()
    render(<KnowledgeViewSwitcher value="new" onChange={vi.fn()} />)

    const trigger = screen.getByRole('button', {
      name: 'dataset.newKnowledge.guideTitle',
    })
    const guide = screen.getByRole('dialog', {
      name: 'dataset.newKnowledge.guideTitle',
    })
    within(guide).getByRole('button', { name: 'dataset.newKnowledge.gotIt' }).focus()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
