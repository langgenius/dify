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

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path?: string) => `https://docs.example.com${path ?? ''}`,
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

  it('dismisses the guide without changing the selected knowledge view', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<KnowledgeViewSwitcher value="new" onChange={onChange} />)

    await user.click(
      within(
        screen.getByRole('dialog', {
          name: 'dataset.newKnowledge.guideTitle',
        }),
      ).getByRole('button', { name: 'dataset.newKnowledge.gotIt' }),
    )

    expect(guideStorageMock.setDismissed).toHaveBeenCalledWith(true)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })
})
