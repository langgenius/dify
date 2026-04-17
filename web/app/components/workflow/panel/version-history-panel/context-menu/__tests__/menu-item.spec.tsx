import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DropdownMenu, DropdownMenuContent } from '@/app/components/base/ui/dropdown-menu'
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
