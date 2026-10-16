import type { Meta, StoryObj } from '@storybook/react-vite'
import * as React from 'react'
import { expect, waitFor, within } from 'storybook/test'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '.'
import { Button } from '../button'

const triggerButtonClassName =
  'rounded-lg border border-divider-subtle bg-components-button-secondary-bg px-3 py-1.5 text-sm text-text-secondary shadow-xs hover:bg-state-base-hover'

const meta = {
  title: 'Base/UI/AlertDialog',
  component: AlertDialog,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Compound alert dialog built on Base UI AlertDialog. Use it for destructive or high-risk confirmations that require an explicit user decision. Compose `AlertDialogTitle` and `AlertDialogDescription` in `AlertDialogHeader`, and the actions in `AlertDialogFooter` with `AlertDialogCancelButton` and `AlertDialogConfirmButton`. The title wraps rather than truncates, so a long object name stays readable.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof AlertDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <AlertDialog>
      <AlertDialogTrigger render={<button type="button" className={triggerButtonClassName} />}>
        Delete project
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete project?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. All workflows, datasets, and API keys will be permanently
            removed.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancelButton variant="secondary">Cancel</AlertDialogCancelButton>
          <AlertDialogConfirmButton>Delete</AlertDialogConfirmButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)

    await userEvent.click(canvas.getByRole('button', { name: 'Delete project' }))

    const dialog = body.getByRole('alertdialog', { name: 'Delete project?' })
    await waitFor(async () => {
      await expect(dialog).toBeVisible()
    })

    await userEvent.click(body.getByRole('button', { name: 'Delete' }))
    await expect(dialog).toBeVisible()

    await userEvent.click(body.getByRole('button', { name: 'Cancel' }))
    await waitFor(async () => {
      await expect(
        body.queryByRole('alertdialog', { name: 'Delete project?' }),
      ).not.toBeInTheDocument()
    })
  },
}

export const NonDestructive: Story = {
  render: () => (
    <AlertDialog>
      <AlertDialogTrigger render={<button type="button" className={triggerButtonClassName} />}>
        Publish changes
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Publish the latest draft?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Collaborators will immediately see the new workflow. You can still revert from version
            history.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancelButton variant="secondary">Not now</AlertDialogCancelButton>
          <AlertDialogConfirmButton tone="default">Publish</AlertDialogConfirmButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ),
}

export const LongObjectName: Story = {
  render: () => (
    <AlertDialog>
      <AlertDialogTrigger render={<button type="button" className={triggerButtonClassName} />}>
        Delete knowledge base
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete “Customer support escalation playbook for enterprise accounts (2026 Q3)”?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {'Documents, segments, and retrieval settings will be removed.\nApps that use this knowledge base will stop retrieving from it.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancelButton>Cancel</AlertDialogCancelButton>
          <AlertDialogConfirmButton>Delete</AlertDialogConfirmButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ),
}

function ControlledDemo() {
  const [open, setOpen] = React.useState(false)
  const [count, setCount] = React.useState(0)

  return (
    <div className="flex flex-col items-center gap-3">
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Open controlled dialog
      </Button>
      <span className="text-xs text-text-tertiary">
        Confirmed
        {count} times
      </span>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Revoke API token?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Any integration using this token will immediately stop working. You can issue a new
              token afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancelButton variant="secondary">Keep token</AlertDialogCancelButton>
            <AlertDialogConfirmButton
              onClick={() => {
                setCount((prev) => prev + 1)
                setOpen(false)
              }}
            >
              Revoke
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export const Controlled: Story = {
  render: () => <ControlledDemo />,
}

function LoadingConfirmDemo() {
  const [pending, setPending] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const confirmLabelId = React.useId()

  const handleConfirm = () => {
    setPending(true)
    window.setTimeout(() => {
      setPending(false)
      setOpen(false)
    }, 1200)
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<button type="button" className={triggerButtonClassName} />}>
        Archive workspace
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Archive this workspace?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Members will lose access until the workspace is restored. This may take a moment to
            finalize.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancelButton variant="secondary" disabled={pending}>
            Cancel
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton
            tone="default"
            loading={pending}
            aria-labelledby={confirmLabelId}
            onClick={handleConfirm}
          >
            <span id={confirmLabelId}>{pending ? 'Archiving…' : 'Archive'}</span>
          </AlertDialogConfirmButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export const LoadingConfirm: Story = {
  render: () => <LoadingConfirmDemo />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)

    await userEvent.click(canvas.getByRole('button', { name: 'Archive workspace' }))
    const confirmButton = body.getByRole('button', { name: 'Archive' })
    await userEvent.click(confirmButton)

    await expect(confirmButton).toHaveAccessibleName('Archiving…')
    await expect(confirmButton).toHaveAttribute('aria-disabled', 'true')
    await expect(confirmButton).not.toHaveAttribute('aria-busy')
    await expect(confirmButton).toHaveFocus()
  },
}
