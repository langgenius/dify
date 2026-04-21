import { DropdownMenu, DropdownMenuContent } from '@langgenius/dify-ui/dropdown-menu'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VersionHistoryContextMenuOptions } from '../../../../types'
import MenuItem from '../menu-item'

describe('MenuItem', () => {
  it('forwards the selected operation and supports destructive styling', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()

    render(
      <DropdownMenu open onOpenChange={vi.fn()}>
        <DropdownMenuContent>
          <MenuItem
            item={{
              key: VersionHistoryContextMenuOptions.delete,
              name: 'Delete',
            }}
            isDestructive
            onClick={onClick}
          />
        </DropdownMenuContent>
      </DropdownMenu>,
    )

    await user.click(screen.getByText('Delete'))

    expect(onClick).toHaveBeenCalledWith(VersionHistoryContextMenuOptions.delete)
  })
})
