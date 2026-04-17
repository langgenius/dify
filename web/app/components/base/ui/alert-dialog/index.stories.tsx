import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '.'
import { Button } from '../button'

const triggerButtonClassName = 'rounded-lg border border-divider-subtle bg-components-button-secondary-bg px-3 py-1.5 text-sm text-text-secondary shadow-xs hover:bg-state-base-hover'

const meta = {
  title: 'Base/UI/AlertDialog',
  component: AlertDialog,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Compound alert dialog built on Base UI AlertDialog. Use it for destructive or high-risk confirmations that require an explicit user decision. Compose title, description, and actions via `AlertDialogActions`, `AlertDialogCancelButton`, and `AlertDialogConfirmButton`.',
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
      <AlertDialogTrigger
        render={<button type="button" className={triggerButtonClassName} />}
      >
        Delete project
      </AlertDialogTrigger>
      <AlertDialogContent>
        <div className="flex flex-col gap-2 p-6 pb-4">
          <AlertDialogTitle className="text-lg leading-7 font-semibold text-text-primary">
            Delete project?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm leading-5 text-text-secondary">
            This action cannot be undone. All workflows, datasets, and API keys will be permanently removed.
          </AlertDialogDescription>
        </div>
        <AlertDialogActions>
          <AlertDialogCancelButton variant="secondary">Cancel</AlertDialogCancelButton>
          <AlertDialogConfirmButton>Delete</AlertDialogConfirmButton>
        </AlertDialogActions>
      </AlertDialogContent>
    </AlertDialog>
  ),
}

export const NonDestructive: Story = {
  render: () => (
    <AlertDialog>
      <AlertDialogTrigger
        render={<button type="button" className={triggerButtonClassName} />}
      >
        Publish changes
      </AlertDialogTrigger>
      <AlertDialogContent>
        <div className="flex flex-col gap-2 p-6 pb-4">
          <AlertDialogTitle className="text-lg leading-7 font-semibold text-text-primary">
            Publish the latest draft?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm leading-5 text-text-secondary">
            Collaborators will immediately see the new workflow. You can still revert from version history.
          </AlertDialogDescription>
        </div>
        <AlertDialogActions>
          <AlertDialogCancelButton variant="secondary">Not now</AlertDialogCancelButton>
          <AlertDialogConfirmButton tone="default">Publish</AlertDialogConfirmButton>
        </AlertDialogActions>
      </AlertDialogContent>
    </AlertDialog>
  ),
}

const ControlledDemo = () => {
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(0)

  return (
    <div className="flex flex-col items-center gap-3">
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Open controlled dialog
      </Button>
      <span className="text-xs text-text-tertiary">
        Confirmed
        {count}
        {' '}
        times
      </span>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <div className="flex flex-col gap-2 p-6 pb-4">
            <AlertDialogTitle className="text-lg leading-7 font-semibold text-text-primary">
              Revoke API token?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-5 text-text-secondary">
              Any integration using this token will immediately stop working. You can issue a new token afterwards.
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton variant="secondary">Keep token</AlertDialogCancelButton>
            <AlertDialogConfirmButton
              onClick={() => {
                setCount(prev => prev + 1)
                setOpen(false)
              }}
            >
              Revoke
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export const Controlled: Story = {
  render: () => <ControlledDemo />,
}

const LoadingConfirmDemo = () => {
  const [pending, setPending] = useState(false)
  const [open, setOpen] = useState(false)

  const handleConfirm = () => {
    setPending(true)
    window.setTimeout(() => {
      setPending(false)
      setOpen(false)
    }, 1200)
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={<button type="button" className={triggerButtonClassName} />}
      >
        Archive workspace
      </AlertDialogTrigger>
      <AlertDialogContent>
        <div className="flex flex-col gap-2 p-6 pb-4">
          <AlertDialogTitle className="text-lg leading-7 font-semibold text-text-primary">
            Archive this workspace?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm leading-5 text-text-secondary">
            Members will lose access until the workspace is restored. This may take a moment to finalize.
          </AlertDialogDescription>
        </div>
        <AlertDialogActions>
          <AlertDialogCancelButton variant="secondary" disabled={pending}>
            Cancel
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton
            tone="default"
            loading={pending}
            onClick={handleConfirm}
          >
            {pending ? 'Archiving…' : 'Archive'}
          </AlertDialogConfirmButton>
        </AlertDialogActions>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export const LoadingConfirm: Story = {
  render: () => <LoadingConfirmDemo />,
}
