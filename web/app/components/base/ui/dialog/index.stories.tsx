import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '.'
import { Button } from '../button'

const triggerButtonClassName = 'rounded-lg border border-divider-subtle bg-components-button-secondary-bg px-3 py-1.5 text-sm text-text-secondary shadow-xs hover:bg-state-base-hover'

const meta = {
  title: 'Base/UI/Dialog',
  component: Dialog,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Compound modal dialog built on Base UI Dialog. Use it for focused flows that interrupt the user, such as editing settings, confirming non-destructive actions, or collecting short-form input. Compose `DialogTitle`, `DialogDescription`, and optional `DialogCloseButton` inside `DialogContent`.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof Dialog>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger
        render={<button type="button" className={triggerButtonClassName} />}
      >
        Open dialog
      </DialogTrigger>
      <DialogContent>
        <DialogCloseButton />
        <div className="flex flex-col gap-2 pr-8">
          <DialogTitle className="text-lg leading-7 font-semibold text-text-primary">
            Invite collaborators
          </DialogTitle>
          <DialogDescription className="text-sm leading-5 text-text-secondary">
            Add teammates by email to share this workspace. They will receive an invitation link.
          </DialogDescription>
        </div>
        <div className="mt-5 flex flex-col gap-2">
          <label className="text-xs font-medium text-text-tertiary" htmlFor="invite-email">
            Email address
          </label>
          <input
            id="invite-email"
            type="email"
            placeholder="teammate@example.com"
            className="h-9 w-full rounded-lg border-[0.5px] border-components-input-border-active bg-components-input-bg-normal px-3 text-sm text-components-input-text-filled outline-hidden placeholder:text-components-input-text-placeholder focus:border-components-input-border-hover"
          />
        </div>
        <div className="mt-6 flex items-center justify-end">
          <Button variant="primary">Send invite</Button>
        </div>
      </DialogContent>
    </Dialog>
  ),
}

export const WithoutCloseButton: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger
        render={<button type="button" className={triggerButtonClassName} />}
      >
        Start onboarding
      </DialogTrigger>
      <DialogContent>
        <div className="flex flex-col gap-2">
          <DialogTitle className="text-lg leading-7 font-semibold text-text-primary">
            Welcome to Dify
          </DialogTitle>
          <DialogDescription className="text-sm leading-5 text-text-secondary">
            Let's get your workspace ready. This takes about a minute and sets up your default models, datasets, and API keys.
          </DialogDescription>
        </div>
        <div className="mt-6 flex items-center justify-end gap-2">
          <Button variant="secondary">Skip for now</Button>
          <Button variant="primary">Start setup</Button>
        </div>
      </DialogContent>
    </Dialog>
  ),
}

const ControlledDemo = () => {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex flex-col items-center gap-3">
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Open controlled dialog
      </Button>
      <span className="text-xs text-text-tertiary">
        State:
        {' '}
        {open ? 'open' : 'closed'}
      </span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogCloseButton />
          <div className="flex flex-col gap-2 pr-8">
            <DialogTitle className="text-lg leading-7 font-semibold text-text-primary">
              Rename workspace
            </DialogTitle>
            <DialogDescription className="text-sm leading-5 text-text-secondary">
              The workspace URL will stay the same, but the display name updates everywhere.
            </DialogDescription>
          </div>
          <input
            type="text"
            defaultValue="Acme Workspace"
            className="mt-4 h-9 w-full rounded-lg border-[0.5px] border-components-input-border-active bg-components-input-bg-normal px-3 text-sm text-components-input-text-filled outline-hidden focus:border-components-input-border-hover"
          />
          <div className="mt-6 flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => setOpen(false)}>
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export const Controlled: Story = {
  render: () => <ControlledDemo />,
}

export const ScrollingContent: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger
        render={<button type="button" className={triggerButtonClassName} />}
      >
        Review release notes
      </DialogTrigger>
      <DialogContent>
        <DialogCloseButton />
        <div className="flex flex-col gap-2 pr-8">
          <DialogTitle className="text-lg leading-7 font-semibold text-text-primary">
            Release notes
          </DialogTitle>
          <DialogDescription className="text-sm leading-5 text-text-secondary">
            Highlights from the latest workspace update.
          </DialogDescription>
        </div>
        <ul className="mt-4 flex flex-col gap-3 text-sm leading-5 text-text-secondary">
          {Array.from({ length: 24 }, (_, index) => `improvement-${index + 1}`).map((id, index) => (
            <li key={id} className="rounded-lg bg-background-default-subtle px-3 py-2">
              <span className="font-medium text-text-primary">
                Improvement #
                {index + 1}
                :
              </span>
              {' '}
              Refined a workflow behavior so long content naturally overflows and scrolls inside the dialog.
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  ),
}
