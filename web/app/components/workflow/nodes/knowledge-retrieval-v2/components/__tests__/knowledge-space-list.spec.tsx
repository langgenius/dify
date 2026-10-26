import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import KnowledgeSpaceList from '../knowledge-space-list'

const spaces = [
  { control_space_id: 'space-1', name: 'Handbook' },
  { control_space_id: 'space-2', name: 'Policies' },
]

describe('KnowledgeSpaceList', () => {
  it('keeps the removal action reachable and operable by keyboard', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <>
        <button type="button">before</button>
        <KnowledgeSpaceList list={spaces.slice(0, 1)} onChange={onChange} />
        <button type="button">after</button>
      </>,
    )

    await user.click(screen.getByRole('button', { name: 'before' }))
    await user.tab()

    const removeButton = screen.getByRole('button', { name: 'common.operation.remove' })
    expect(removeButton).toHaveFocus()
    // The action stays rendered (revealed with opacity) instead of display:none until hover.
    expect(removeButton.parentElement).not.toHaveClass('hidden')
    expect(removeButton.parentElement).toHaveClass('focus-within:opacity-100')

    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('removes only the chosen space', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<KnowledgeSpaceList list={spaces} onChange={onChange} />)

    await user.click(screen.getAllByRole('button', { name: 'common.operation.remove' })[1]!)

    expect(onChange).toHaveBeenCalledWith([spaces[0]])
  })

  it('hides the removal action when readonly', () => {
    render(<KnowledgeSpaceList list={spaces} onChange={vi.fn()} readonly />)

    expect(
      screen.queryByRole('button', { name: 'common.operation.remove' }),
    ).not.toBeInTheDocument()
  })
})
