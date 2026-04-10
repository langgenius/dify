import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VersionHistoryContextMenuOptions } from '../../../../types'
import MenuItem from '../menu-item'

describe('MenuItem', () => {
  it('forwards the selected operation and supports destructive styling', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()

    render(
      <MenuItem
        item={{
          key: VersionHistoryContextMenuOptions.delete,
          name: 'Delete',
        }}
        isDestructive
        onClick={onClick}
      />,
    )

    await user.click(screen.getByText('Delete'))

    expect(onClick).toHaveBeenCalledWith(VersionHistoryContextMenuOptions.delete)
  })
})
