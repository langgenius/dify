import type { ChecklistItem } from '../../../hooks/use-checklist'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum } from '../../../types'
import { ChecklistNodeGroup } from '../node-group'

const createItem = (overrides: Partial<ChecklistItem> = {}): ChecklistItem => ({
  id: 'node-1',
  type: BlockEnum.LLM,
  title: 'Broken Node',
  errorMessages: ['Needs configuration'],
  canNavigate: true,
  disableGoTo: false,
  unConnected: false,
  ...overrides,
})

describe('ChecklistNodeGroup', () => {
  it('should render errors and the connection warning, and allow navigation when go-to is enabled', async () => {
    const user = userEvent.setup()
    const onItemClick = vi.fn()

    render(
      <ChecklistNodeGroup
        item={createItem({ unConnected: true })}
        showGoTo={true}
        onItemClick={onItemClick}
      />,
    )

    expect(screen.getByText('Needs configuration')).toBeInTheDocument()
    expect(screen.getByText(/needConnectTip/i)).toBeInTheDocument()
    expect(screen.getAllByText(/goToFix/i)).toHaveLength(2)
    expect(screen.getByRole('button', { name: /Needs configuration/i })).toHaveAttribute(
      'title',
      'Needs configuration',
    )

    await user.click(screen.getByText('Needs configuration'))

    expect(onItemClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'node-1' }))
  })

  it('should not allow navigation when go-to is disabled', async () => {
    const user = userEvent.setup()
    const onItemClick = vi.fn()

    render(
      <ChecklistNodeGroup
        item={createItem({ disableGoTo: true })}
        showGoTo={true}
        onItemClick={onItemClick}
      />,
    )

    await user.click(screen.getByText('Needs configuration'))

    expect(onItemClick).not.toHaveBeenCalled()
    expect(screen.queryByText(/goToFix/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Needs configuration/i })).not.toBeInTheDocument()
    expect(screen.getByText('Needs configuration').parentElement).toHaveAttribute(
      'title',
      'Needs configuration',
    )
  })
})
