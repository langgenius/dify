import { fireEvent, render, screen } from '@testing-library/react'
import { BlockEnum } from '../../../types'
import { ChecklistNodeGroup } from '../node-group'

vi.mock('../../../block-icon', () => ({
  default: () => <div data-testid="block-icon" />,
}))

vi.mock('../item-indicator', () => ({
  ItemIndicator: () => <div data-testid="item-indicator" />,
}))

const createItem = (overrides: Record<string, unknown> = {}) => ({
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
  it('should render errors and the connection warning, and allow navigation when go-to is enabled', () => {
    const onItemClick = vi.fn()

    render(
      <ChecklistNodeGroup
        item={createItem({ unConnected: true }) as never}
        showGoTo={true}
        onItemClick={onItemClick}
      />,
    )

    expect(screen.getByText('Needs configuration')).toBeInTheDocument()
    expect(screen.getByText(/needConnectTip/i)).toBeInTheDocument()
    expect(screen.getAllByText(/goToFix/i)).toHaveLength(2)
    expect(screen.getByRole('button', { name: /Needs configuration/i })).toHaveAttribute('title', 'Needs configuration')

    fireEvent.click(screen.getByText('Needs configuration'))

    expect(onItemClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'node-1' }))
  })

  it('should not allow navigation when go-to is disabled', () => {
    const onItemClick = vi.fn()

    render(
      <ChecklistNodeGroup
        item={createItem({ disableGoTo: true }) as never}
        showGoTo={true}
        onItemClick={onItemClick}
      />,
    )

    fireEvent.click(screen.getByText('Needs configuration'))

    expect(onItemClick).not.toHaveBeenCalled()
    expect(screen.queryByText(/goToFix/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Needs configuration/i })).not.toBeInTheDocument()
    expect(screen.getByText('Needs configuration').parentElement).toHaveAttribute('title', 'Needs configuration')
  })
})
