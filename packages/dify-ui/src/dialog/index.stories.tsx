import type { Meta, StoryObj } from '@storybook/react-vite'
import * as React from 'react'
import { expect, waitFor, within } from 'storybook/test'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '.'
import { Button } from '../button'
import { FieldControl, FieldDescription, FieldError, FieldLabel, FieldRoot } from '../field'
import { Form } from '../form'
import { Input } from '../input'

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
        render={<Button />}
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
          <Input
            id="invite-email"
            type="email"
            placeholder="teammate@example.com"
          />
        </div>
        <div className="mt-6 flex items-center justify-end">
          <Button variant="primary">Send invite</Button>
        </div>
      </DialogContent>
    </Dialog>
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)

    await userEvent.click(canvas.getByRole('button', { name: 'Open dialog' }))

    const dialog = body.getByRole('dialog', { name: 'Invite collaborators' })
    await waitFor(async () => {
      await expect(dialog).toBeVisible()
    })
    await expect(body.getByRole('textbox', { name: 'Email address' })).toBeVisible()

    await userEvent.click(body.getByRole('button', { name: 'Close' }))
    await waitFor(async () => {
      await expect(body.queryByRole('dialog', { name: 'Invite collaborators' })).not.toBeInTheDocument()
    })
  },
}

export const WithoutCloseButton: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger
        render={<Button />}
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
  const [open, setOpen] = React.useState(false)

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
          <Input
            type="text"
            defaultValue="Acme Workspace"
            className="mt-4"
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

type ApiExtensionFormValues = {
  name: string
  endpoint: string
  apiKey: string
}

const FormDialogDemo = () => {
  const [open, setOpen] = React.useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen} disablePointerDismissal>
      <DialogTrigger
        render={<Button />}
      >
        Configure API extension
      </DialogTrigger>
      <DialogContent backdropProps={{ forceRender: true }} className="w-160">
        <DialogCloseButton />
        <div className="grid gap-2 pr-8">
          <DialogTitle className="text-lg leading-7 font-semibold text-text-primary">
            Configure API extension
          </DialogTitle>
          <DialogDescription className="text-sm leading-5 text-text-secondary">
            Save the endpoint and credentials used by this workspace integration.
          </DialogDescription>
        </div>
        <Form<ApiExtensionFormValues>
          className="grid gap-4 pt-5"
          onFormSubmit={() => setOpen(false)}
        >
          <FieldRoot name="name">
            <FieldLabel>Name</FieldLabel>
            <FieldControl required placeholder="Production API" />
            <FieldError match="valueMissing">Name is required.</FieldError>
          </FieldRoot>
          <FieldRoot name="endpoint">
            <FieldLabel>Endpoint</FieldLabel>
            <FieldControl type="url" required placeholder="https://api.example.com" />
            <FieldDescription>
              <a
                href="https://docs.dify.ai/use-dify/workspace/api-extension/api-extension"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-fit items-center text-text-accent outline-hidden focus-visible:ring-1 focus-visible:ring-components-input-border-active"
              >
                View API extension docs
              </a>
            </FieldDescription>
            <FieldError match="valueMissing">Endpoint is required.</FieldError>
            <FieldError match="typeMismatch">Enter a valid URL.</FieldError>
          </FieldRoot>
          <FieldRoot
            name="apiKey"
            validate={(value) => {
              if (typeof value === 'string' && value.length > 0 && value.length < 5)
                return 'API key must be at least 5 characters.'

              return null
            }}
          >
            <FieldLabel>API key</FieldLabel>
            <FieldControl required placeholder="sk-..." />
            <FieldError match="valueMissing">API key is required.</FieldError>
            <FieldError match="customError" />
          </FieldRoot>
          <div className="mt-2 flex items-center justify-end gap-2">
            <Button type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Save
            </Button>
          </div>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

export const FormDialog: Story = {
  render: () => <FormDialogDemo />,
}

export const ScrollingContent: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger
        render={<Button />}
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
