import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MenuItem from '../menu-item'

const TestIcon = ({ className }: { className?: string }) => (
  <span data-testid="menu-item-icon" className={className} />
)

describe('MenuItem', () => {
  it('should stop propagation and invoke the click handler', async () => {
    const user = userEvent.setup()
    const handleClick = vi.fn()
    const parentClick = vi.fn()

    render(
      <div onClick={parentClick}>
        <MenuItem name="Edit" Icon={TestIcon} handleClick={handleClick} />
      </div>,
    )

    await user.click(screen.getByText('Edit'))

    expect(handleClick).toHaveBeenCalledTimes(1)
    expect(parentClick).not.toHaveBeenCalled()
  })
})
