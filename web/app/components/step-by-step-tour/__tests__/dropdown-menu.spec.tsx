import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  getStepByStepTourDropdownMenuContentProps,
  useStepByStepTourControlledDropdown,
} from '../dropdown-menu'

const STEP_BY_STEP_TOUR_HIGHLIGHT_PART_DATA_ATTR = 'data-step-by-step-tour-highlight-part'

const getHighlightPartValue = (props: unknown): string | undefined => {
  if (!props || typeof props !== 'object') return undefined

  const value = (props as Record<string, unknown>)[STEP_BY_STEP_TOUR_HIGHLIGHT_PART_DATA_ATTR]
  return typeof value === 'string' ? value : undefined
}

const noopKeyboardHandler = () => {}

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
      <div
        aria-label="dropdown"
        data-controlled={String(menu.controlled)}
        data-open={String(menu.open)}
      />
    </>
  )
}

describe('useStepByStepTourControlledDropdown', () => {
  it('keeps ordinary dropdown toggle behavior when no tour controls it', () => {
    render(<TestDropdown />)

    expect(screen.getByLabelText('dropdown')).toHaveAttribute('data-open', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'Toggle menu' }))

    expect(screen.getByLabelText('dropdown')).toHaveAttribute('data-open', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Toggle menu' }))

    expect(screen.getByLabelText('dropdown')).toHaveAttribute('data-open', 'false')
  })

  it('opens for a tour step without locking the dropdown open', () => {
    render(<TestDropdown controlledOpen />)

    expect(screen.getByLabelText('dropdown')).toHaveAttribute('data-open', 'true')
    expect(screen.getByLabelText('dropdown')).toHaveAttribute('data-controlled', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Toggle menu' }))

    expect(screen.getByLabelText('dropdown')).toHaveAttribute('data-open', 'false')
    expect(screen.getByLabelText('dropdown')).toHaveAttribute('data-controlled', 'false')
  })

  it('can keep a tour-opened dropdown locked until the tour leaves the step', () => {
    render(<TestDropdown controlledOpen allowTriggerCloseWhileControlled={false} />)

    expect(screen.getByLabelText('dropdown')).toHaveAttribute('data-open', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Toggle menu' }))

    expect(screen.getByLabelText('dropdown')).toHaveAttribute('data-open', 'true')
    expect(screen.getByLabelText('dropdown')).toHaveAttribute('data-controlled', 'true')
  })

  it('allows an action to close a locked tour-opened dropdown', () => {
    render(<TestDropdown controlledOpen allowTriggerCloseWhileControlled={false} />)

    expect(screen.getByLabelText('dropdown')).toHaveAttribute('data-open', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Close from action' }))

    expect(screen.getByLabelText('dropdown')).toHaveAttribute('data-open', 'false')
    expect(screen.getByLabelText('dropdown')).toHaveAttribute('data-controlled', 'false')
  })

  it('closes when the tour leaves the dropdown step', async () => {
    const { rerender } = render(<TestDropdown controlledOpen />)

    expect(screen.getByLabelText('dropdown')).toHaveAttribute('data-open', 'true')

    rerender(<TestDropdown />)

    await waitFor(() => {
      expect(screen.getByLabelText('dropdown')).toHaveAttribute('data-open', 'false')
    })
  })
})

describe('getStepByStepTourDropdownMenuContentProps', () => {
  it('blocks presentation menu interactions without letting clicks bubble through', () => {
    const onAction = vi.fn()
    const onBackgroundClick = vi.fn()
    const { popupClassName, popupProps, positionerProps } =
      getStepByStepTourDropdownMenuContentProps({
        highlightPart: 'tour-menu',
        interactionMode: 'presentation',
      })

    render(
      <div role="button" tabIndex={0} onClick={onBackgroundClick} onKeyDown={noopKeyboardHandler}>
        <div
          data-testid="positioner"
          data-step-by-step-tour-highlight-part={getHighlightPartValue(positionerProps)}
          onClickCapture={positionerProps?.onClickCapture}
          onKeyDownCapture={positionerProps?.onKeyDownCapture}
          onMouseDownCapture={positionerProps?.onMouseDownCapture}
          onPointerDownCapture={positionerProps?.onPointerDownCapture}
        >
          <div
            role="menu"
            aria-hidden={popupProps?.['aria-hidden']}
            onClickCapture={popupProps?.onClickCapture}
            onKeyDownCapture={popupProps?.onKeyDownCapture}
            onMouseDownCapture={popupProps?.onMouseDownCapture}
            onPointerDownCapture={popupProps?.onPointerDownCapture}
          >
            <button type="button" role="menuitem" onClick={onAction}>
              Delete
            </button>
          </div>
        </div>
      </div>,
    )

    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete', hidden: true }))

    expect(onAction).not.toHaveBeenCalled()
    expect(onBackgroundClick).not.toHaveBeenCalled()
    expect(screen.getByRole('menu', { hidden: true })).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByTestId('positioner')).toHaveAttribute(
      'data-step-by-step-tour-highlight-part',
      'tour-menu',
    )
    expect(popupClassName).toContain('pointer-events-none')
  })

  it('preserves presentation popup event handlers before blocking direct popup interactions', () => {
    const onAction = vi.fn()
    const onBackgroundClick = vi.fn()
    const onPopupClickCapture = vi.fn()
    const { popupProps } = getStepByStepTourDropdownMenuContentProps({
      interactionMode: 'presentation',
      popupProps: {
        onClickCapture: onPopupClickCapture,
      },
    })

    render(
      <div role="button" tabIndex={0} onClick={onBackgroundClick} onKeyDown={noopKeyboardHandler}>
        <div
          role="menu"
          tabIndex={-1}
          aria-hidden={popupProps?.['aria-hidden']}
          onClickCapture={popupProps?.onClickCapture}
        >
          <button type="button" role="menuitem" onClick={onAction}>
            Delete
          </button>
        </div>
      </div>,
    )

    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete', hidden: true }))

    expect(onPopupClickCapture).toHaveBeenCalledTimes(1)
    expect(onAction).not.toHaveBeenCalled()
    expect(onBackgroundClick).not.toHaveBeenCalled()
  })

  it('preserves presentation positioner event handlers before blocking interactions', () => {
    const onAction = vi.fn()
    const onBackgroundClick = vi.fn()
    const onPositionerClickCapture = vi.fn()
    const { popupProps, positionerProps } = getStepByStepTourDropdownMenuContentProps({
      highlightPart: 'tour-menu',
      interactionMode: 'presentation',
      positionerProps: {
        onClickCapture: onPositionerClickCapture,
      },
    })

    render(
      <div role="button" tabIndex={0} onClick={onBackgroundClick} onKeyDown={noopKeyboardHandler}>
        <div
          data-testid="positioner"
          data-step-by-step-tour-highlight-part={getHighlightPartValue(positionerProps)}
          onClickCapture={positionerProps?.onClickCapture}
        >
          <div role="menu" aria-hidden={popupProps?.['aria-hidden']}>
            <button type="button" role="menuitem" onClick={onAction}>
              Delete
            </button>
          </div>
        </div>
      </div>,
    )

    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete', hidden: true }))

    expect(onPositionerClickCapture).toHaveBeenCalledTimes(1)
    expect(onAction).not.toHaveBeenCalled()
    expect(onBackgroundClick).not.toHaveBeenCalled()
    expect(screen.getByTestId('positioner')).toHaveAttribute(
      'data-step-by-step-tour-highlight-part',
      'tour-menu',
    )
  })

  it('leaves interactive menus clickable without bubbling through', () => {
    const onAction = vi.fn()
    const onBackgroundClick = vi.fn()
    const onPopupClick = vi.fn()
    const { popupProps, positionerProps } = getStepByStepTourDropdownMenuContentProps({
      highlightPart: 'tour-menu',
      interactionMode: 'interactive',
      popupProps: {
        onClick: onPopupClick,
      },
    })

    render(
      <div role="button" tabIndex={0} onClick={onBackgroundClick} onKeyDown={noopKeyboardHandler}>
        <div data-step-by-step-tour-highlight-part={getHighlightPartValue(positionerProps)}>
          <div
            role="menu"
            tabIndex={-1}
            aria-hidden={popupProps?.['aria-hidden']}
            onClick={popupProps?.onClick}
            onKeyDown={noopKeyboardHandler}
          >
            <button type="button" role="menuitem" onClick={onAction}>
              Create
            </button>
          </div>
        </div>
      </div>,
    )

    fireEvent.click(screen.getByRole('menuitem', { name: 'Create' }))

    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onPopupClick).toHaveBeenCalledTimes(1)
    expect(onBackgroundClick).not.toHaveBeenCalled()
  })
})
