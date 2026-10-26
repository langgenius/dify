import { Menu, MenuContent, MenuItem, MenuTrigger } from '@langgenius/dify-ui/menu'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { getStepByStepTourMenuContentProps, useStepByStepTourControlledMenu } from '../menu'

function TestMenu({
  allowTriggerCloseWhileControlled,
  controlledOpen,
}: {
  allowTriggerCloseWhileControlled?: boolean
  controlledOpen?: boolean
}) {
  const menu = useStepByStepTourControlledMenu({
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

describe('useStepByStepTourControlledMenu', () => {
  it('keeps ordinary menu toggle behavior when no tour controls it', async () => {
    const user = userEvent.setup()
    render(<TestMenu />)

    expect(screen.getByText('Menu is closed and uncontrolled')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Toggle menu' }))

    expect(screen.getByText('Menu is open and uncontrolled')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Toggle menu' }))

    expect(screen.getByText('Menu is closed and uncontrolled')).toBeInTheDocument()
  })

  it('opens for a tour step without locking the menu open', async () => {
    const user = userEvent.setup()
    render(<TestMenu controlledOpen />)

    expect(screen.getByText('Menu is open and controlled')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Toggle menu' }))

    expect(screen.getByText('Menu is closed and uncontrolled')).toBeInTheDocument()
  })

  it('can keep a tour-opened menu locked until the tour leaves the step', async () => {
    const user = userEvent.setup()
    render(<TestMenu controlledOpen allowTriggerCloseWhileControlled={false} />)

    expect(screen.getByText('Menu is open and controlled')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Toggle menu' }))

    expect(screen.getByText('Menu is open and controlled')).toBeInTheDocument()
  })

  it('closes when the tour leaves the menu step', async () => {
    const { rerender } = render(<TestMenu controlledOpen />)

    expect(screen.getByText('Menu is open and controlled')).toBeInTheDocument()

    rerender(<TestMenu />)

    await waitFor(() => {
      expect(screen.getByText('Menu is closed and uncontrolled')).toBeInTheDocument()
    })
  })
})

describe('getStepByStepTourMenuContentProps', () => {
  it('blocks presentation menu interactions without letting clicks bubble through', () => {
    const onAction = vi.fn()
    const onBackgroundClick = vi.fn()

    render(
      <Menu open>
        <MenuTrigger>Open menu</MenuTrigger>
        <MenuContent
          {...getStepByStepTourMenuContentProps({
            highlightPart: 'tour-menu',
            interactionMode: 'presentation',
          })}
        >
          <MenuItem onClick={onAction}>Delete</MenuItem>
        </MenuContent>
      </Menu>,
    )
    document.addEventListener('click', onBackgroundClick)
    try {
      // Exercise capture-phase rejection even if a click is dispatched to the presentation-only menu.
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete', hidden: true }))

      expect(onAction).not.toHaveBeenCalled()
      expect(onBackgroundClick).not.toHaveBeenCalled()
      expect(screen.getByRole('menu', { hidden: true })).toHaveAttribute('aria-hidden', 'true')
      expect(screen.getByRole('menu', { hidden: true })).toHaveAttribute(
        'data-step-by-step-tour-highlight-part',
        'tour-menu',
      )
    } finally {
      document.removeEventListener('click', onBackgroundClick)
    }
  })

  it('leaves interactive menus clickable without bubbling through', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    const onBackgroundClick = vi.fn()

    render(
      <Menu open>
        <MenuTrigger>Open menu</MenuTrigger>
        <MenuContent
          {...getStepByStepTourMenuContentProps({
            highlightPart: 'tour-menu',
            interactionMode: 'interactive',
          })}
        >
          <MenuItem onClick={onAction}>Create</MenuItem>
        </MenuContent>
      </Menu>,
    )
    document.addEventListener('click', onBackgroundClick)
    try {
      await user.click(screen.getByRole('menuitem', { name: 'Create' }))

      expect(onAction).toHaveBeenCalledTimes(1)
      expect(onBackgroundClick).not.toHaveBeenCalled()
      expect(screen.getByRole('menu')).toHaveAttribute(
        'data-step-by-step-tour-highlight-part',
        'tour-menu',
      )
    } finally {
      document.removeEventListener('click', onBackgroundClick)
    }
  })
})
