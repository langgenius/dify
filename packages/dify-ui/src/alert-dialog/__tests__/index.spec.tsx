import * as React from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../index'

describe('AlertDialog wrapper', () => {
  describe('Props', () => {
    it('should move focus to the requested initial target', async () => {
      const initialFocusRef = React.createRef<HTMLButtonElement>()
      const screen = await render(
        <AlertDialog open>
          <AlertDialogContent initialFocus={initialFocusRef}>
            <AlertDialogTitle>Title</AlertDialogTitle>
            <button ref={initialFocusRef} type="button">
              Focus target
            </button>
          </AlertDialogContent>
        </AlertDialog>,
      )

      await expect.element(screen.getByRole('button', { name: 'Focus target' })).toHaveFocus()
    })

    it('should not render a close button by default', async () => {
      const screen = await render(
        <AlertDialog open>
          <AlertDialogContent>
            <AlertDialogTitle>Title</AlertDialogTitle>
          </AlertDialogContent>
        </AlertDialog>,
      )

      expect(() => screen.getByRole('button', { name: 'Close' }).element()).toThrow()
    })

    it('should apply backdrop props to a nested alert dialog backdrop', async () => {
      const screen = await render(
        <AlertDialog open>
          <AlertDialogContent>
            <AlertDialogTitle>Parent confirmation</AlertDialogTitle>
            <AlertDialog open>
              <AlertDialogContent
                backdropProps={{
                  className: 'bg-transparent',
                  forceRender: true,
                  id: 'nested-alert-dialog-backdrop',
                }}
              >
                <AlertDialogTitle>Nested confirmation</AlertDialogTitle>
              </AlertDialogContent>
            </AlertDialog>
          </AlertDialogContent>
        </AlertDialog>,
      )

      const backdrop = document.querySelector('#nested-alert-dialog-backdrop')
      expect(backdrop).toBeInstanceOf(HTMLElement)
      expect(getComputedStyle(backdrop as HTMLElement).backgroundColor).toBe('rgba(0, 0, 0, 0)')
      await expect
        .element(screen.getByRole('alertdialog', { name: 'Nested confirmation' }))
        .not.toHaveAttribute('id', 'nested-alert-dialog-backdrop')
    })
  })

  describe('Dismissal', () => {
    it('should remain open when the user clicks outside the alert dialog', async () => {
      const screen = await render(
        <AlertDialog defaultOpen>
          <AlertDialogContent>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
            <AlertDialogCancelButton>Cancel</AlertDialogCancelButton>
          </AlertDialogContent>
        </AlertDialog>,
      )

      await userEvent.click(document.body)

      await expect
        .element(screen.getByRole('alertdialog', { name: 'Delete project?' }))
        .toBeInTheDocument()
    })

    it('should close when the user activates the cancel action', async () => {
      const screen = await render(
        <AlertDialog defaultOpen>
          <AlertDialogContent>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogCancelButton>Cancel</AlertDialogCancelButton>
          </AlertDialogContent>
        </AlertDialog>,
      )

      await screen.getByRole('button', { name: 'Cancel' }).click()

      await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
    })

    it('should close with Escape and restore focus to the trigger', async () => {
      const screen = await render(
        <AlertDialog>
          <AlertDialogTrigger>Delete project</AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogCancelButton>Cancel</AlertDialogCancelButton>
          </AlertDialogContent>
        </AlertDialog>,
      )

      const trigger = screen.getByRole('button', { name: 'Delete project' })
      await trigger.click()
      await userEvent.keyboard('{Escape}')

      await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
      await expect.element(trigger).toHaveFocus()
    })
  })
})

it('resolves both cancel-button styling layers with the final disabled state', async () => {
  const buttonRef = React.createRef<HTMLButtonElement>()
  const closeRef = React.createRef<HTMLButtonElement>()
  const onButtonClick = vi.fn()
  const onCloseClick = vi.fn()
  function Confirmation({ loading }: { loading: boolean }) {
    return (
      <AlertDialog defaultOpen>
        <AlertDialogContent>
          <AlertDialogTitle>Confirm changes</AlertDialogTitle>
          <AlertDialogCancelButton
            loading={loading}
            ref={buttonRef}
            onClick={onButtonClick}
            className={(state) => (state.disabled ? 'opacity-50' : 'opacity-100')}
            style={(state) => ({ color: state.disabled ? 'red' : 'blue' })}
            closeProps={{
              ref: closeRef,
              onClick: onCloseClick,
              className: (state) => (state.disabled ? 'underline' : 'no-underline'),
              style: { backgroundColor: 'yellow' },
            }}
          >
            Cancel
          </AlertDialogCancelButton>
        </AlertDialogContent>
      </AlertDialog>
    )
  }
  const screen = await render(<Confirmation loading />)
  const cancel = screen.getByRole('button', { name: 'Cancel' })
  await expect.element(cancel).toHaveStyle({
    opacity: '0.5',
    color: 'rgb(255, 0, 0)',
    backgroundColor: 'rgb(255, 255, 0)',
    textDecorationLine: 'underline',
  })
  expect(buttonRef.current).toBe(cancel.element())
  expect(closeRef.current).toBe(cancel.element())

  await screen.rerender(<Confirmation loading={false} />)
  await expect
    .element(cancel)
    .toHaveStyle({ opacity: '1', color: 'rgb(0, 0, 255)', textDecorationLine: 'none' })
  await cancel.click()
  expect(onButtonClick).toHaveBeenCalledTimes(1)
  expect(onCloseClick).toHaveBeenCalledTimes(1)
  await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
})
