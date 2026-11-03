import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { KnowledgeViewSwitcher } from '../knowledge-view-switcher'

const guide = () => screen.getByRole('dialog', { name: 'knowledgeSpace.guideTitle' })

describe('KnowledgeViewSwitcher', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('remembers a dismissed guide without changing the selected view', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { unmount } = render(<KnowledgeViewSwitcher value="agent" onChange={onChange} />)

    await user.click(within(guide()).getByRole('button', { name: 'knowledgeSpace.gotIt' }))
    unmount()
    render(<KnowledgeViewSwitcher value="agent" onChange={onChange} />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('leaves focus alone when the guide opens itself and focuses Got it when reopened', async () => {
    const user = userEvent.setup()
    render(<KnowledgeViewSwitcher value="classic" onChange={vi.fn()} />)

    expect(guide()).not.toContainElement(document.activeElement as HTMLElement)
    await user.click(within(guide()).getByRole('button', { name: 'knowledgeSpace.gotIt' }))
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.guideTitle' }))

    expect(
      await within(guide()).findByRole('button', { name: 'knowledgeSpace.gotIt' }),
    ).toHaveFocus()
  })
})
