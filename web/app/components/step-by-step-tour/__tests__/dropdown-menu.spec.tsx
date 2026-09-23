import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  getStepByStepTourDropdownMenuContentProps,
  useStepByStepTourControlledDropdown,
} from '../dropdown-menu'

function TestDropdown({
  allowTriggerCloseWhileControlled,
  controlledOpen,
}: {
  allowTriggerCloseWhileControlled?: boolean
  controlledOpen?: boolean
}) {
  const menu = useStepByStepTourControlledDropdown({
    allowTriggerCloseWhileControlled,
    controlledOpen,
  })

  return (
    <>
      <button type="button" onClick={() => menu.onOpenChange(!menu.open)}>
        Toggle menu
      </button>
      <button type="button" onClick={menu.close}>
        Close from action
      </button>
      <p>{`Menu is ${menu.open ? 'open' : 'closed'} and ${menu.controlled ? 'controlled' : 'uncontrolled'}`}</p>
    </>
  )
}

describe('useStepByStepTourControlledDropdown', () => {
  it('keeps ordinary dropdown toggle behavior when no tour controls it', () => {
    render(<TestDropdown />)

    expect(screen.getByText('Menu is closed and uncontrolled')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Toggle menu' }))

    expect(screen.getByText('Menu is open and uncontrolled')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Toggle menu' }))

    expect(screen.getByText('Menu is closed and uncontrolled')).toBeInTheDocument()
  })

  it('opens for a tour step without locking the dropdown open', () => {
    render(<TestDropdown controlledOpen />)

    expect(screen.getByText('Menu is open and controlled')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Toggle menu' }))

    expect(screen.getByText('Menu is closed and uncontrolled')).toBeInTheDocument()
  })

  it('can keep a tour-opened dropdown locked until the tour leaves the step', () => {
    render(<TestDropdown controlledOpen allowTriggerCloseWhileControlled={false} />)

    expect(screen.getByText('Menu is open and controlled')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Toggle menu' }))

    expect(screen.getByText('Menu is open and controlled')).toBeInTheDocument()
  })

  it('closes when the tour leaves the dropdown step', async () => {
    const { rerender } = render(<TestDropdown controlledOpen />)

    expect(screen.getByText('Menu is open and controlled')).toBeInTheDocument()

    rerender(<TestDropdown />)

    await waitFor(() => {
      expect(screen.getByText('Menu is closed and uncontrolled')).toBeInTheDocument()
    })
  })
})

describe('getStepByStepTourDropdownMenuContentProps', () => {
  it('blocks presentation menu interactions without letting clicks bubble through', () => {
    const onAction = vi.fn()
    const onBackgroundClick = vi.fn()

    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Open menu</DropdownMenuTrigger>
        <DropdownMenuContent
          {...getStepByStepTourDropdownMenuContentProps({
            highlightPart: 'tour-menu',
            interactionMode: 'presentation',
          })}
        >
          <DropdownMenuItem onClick={onAction}>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    )
    document.addEventListener('click', onBackgroundClick)

    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete', hidden: true }))

    expect(onAction).not.toHaveBeenCalled()
    expect(onBackgroundClick).not.toHaveBeenCalled()
    expect(screen.getByRole('menu', { hidden: true })).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('menu', { hidden: true })).toHaveAttribute(
      'data-step-by-step-tour-highlight-part',
      'tour-menu',
    )
    document.removeEventListener('click', onBackgroundClick)
  })

  it('leaves interactive menus clickable without bubbling through', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    const onBackgroundClick = vi.fn()

    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Open menu</DropdownMenuTrigger>
        <DropdownMenuContent
          {...getStepByStepTourDropdownMenuContentProps({
            highlightPart: 'tour-menu',
            interactionMode: 'interactive',
          })}
        >
          <DropdownMenuItem onClick={onAction}>Create</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    )
    document.addEventListener('click', onBackgroundClick)

    await user.click(screen.getByRole('menuitem', { name: 'Create' }))

    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onBackgroundClick).not.toHaveBeenCalled()
    expect(screen.getByRole('menu')).toHaveAttribute(
      'data-step-by-step-tour-highlight-part',
      'tour-menu',
    )
    document.removeEventListener('click', onBackgroundClick)
  })
})
