import type { Meta, StoryObj } from '@storybook/react-vite'
import type { AlertDialogActions } from '.'
import * as React from 'react'
import { expect, waitFor, within } from 'storybook/test'
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  createAlertDialogHandle,
} from '.'
import { Button } from '../button'
import { Field, FieldLabel } from '../field'
import { Form } from '../form'
import { Input } from '../input'

const meta = {
  title: 'Base/UI/AlertDialog',
  component: AlertDialog,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: [
          'Compound alert dialog built on Base UI AlertDialog. Use it for a destructive or must-confirm decision that needs an explicit answer: an outside press does not dismiss it, only Escape, `AlertDialogCancelButton` or your confirm action do. Compose `AlertDialogTitle` and `AlertDialogDescription` in `AlertDialogHeader`, anything the user fills in or reviews before answering in `AlertDialogBody`, and the actions in `AlertDialogFooter`.',
          '',
          '`AlertDialogCancelButton` closes on its own. `AlertDialogConfirmButton` is a primary destructive button that only runs your handler; close it afterwards through `actionsRef`, a handle, or controlled `open`. Pass `tone="default"` when the confirmation is not destructive.',
        ].join('\n'),
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
      <AlertDialogTrigger render={<Button variant="secondary" tone="destructive" />}>
        Delete project
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete project?</AlertDialogTitle>
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
    const dialog = await body.findByRole('alertdialog', { name: 'Delete project?' })
    await waitFor(async () => {
      await expect(dialog).toBeVisible()
    })

    await userEvent.click(canvasElement.ownerDocument.body)
    await expect(dialog).toHaveAttribute('data-open')

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(async () => {
      await expect(body.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    await expect(canvas.getByRole('button', { name: 'Delete project' })).toHaveFocus()
  },
}

function TypeToConfirmDemo() {
  const [value, setValue] = React.useState('')
  const actionsRef = React.useRef<AlertDialogActions>(null)

  return (
    <AlertDialog actionsRef={actionsRef}>
      <AlertDialogTrigger render={<Button variant="secondary" tone="destructive" />}>
        Delete workspace
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this workspace?</AlertDialogTitle>
          <AlertDialogDescription>
            Deleting the workspace is irreversible. Members lose access and every app in it is
            permanently removed.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Form className="contents" onFormSubmit={() => actionsRef.current?.close()}>
          <AlertDialogBody>
            <Field name="confirm">
              <FieldLabel>To confirm, type Acme in the box below:</FieldLabel>
              <Input placeholder="Enter workspace name..." value={value} onValueChange={setValue} />
            </Field>
          </AlertDialogBody>
          <AlertDialogFooter>
            <AlertDialogCancelButton variant="secondary">Cancel</AlertDialogCancelButton>
            <AlertDialogConfirmButton type="submit" disabled={value !== 'Acme'}>
              Delete
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </Form>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export const TypeToConfirm: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'The field sits in `AlertDialogBody` and receives initial focus. The confirm is the form submit, disabled until the typed name matches, so Enter cannot confirm early; `onFormSubmit` closes through `actionsRef`.',
      },
    },
  },
  render: () => <TypeToConfirmDemo />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)

    await userEvent.click(canvas.getByRole('button', { name: 'Delete workspace' }))
    const dialog = await body.findByRole('alertdialog', { name: 'Delete this workspace?' })
    const input = within(dialog).getByRole('textbox', { name: /To confirm/ })
    await waitFor(async () => {
      await expect(input).toHaveFocus()
    })
    const confirmButton = within(dialog).getByRole('button', { name: 'Delete' })
    await expect(confirmButton).toBeDisabled()

    await userEvent.type(input, 'Acm')
    await userEvent.keyboard('{Enter}')
    await expect(confirmButton).toBeDisabled()
    await expect(dialog).toHaveAttribute('data-open')

    await userEvent.type(input, 'e')
    await waitFor(async () => {
      await expect(confirmButton).toBeEnabled()
    })

    await userEvent.keyboard('{Enter}')
    await waitFor(async () => {
      await expect(body.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
  },
}

function NonDestructiveDemo() {
  const actionsRef = React.useRef<AlertDialogActions>(null)

  return (
    <AlertDialog actionsRef={actionsRef}>
      <AlertDialogTrigger render={<Button variant="primary" />}>Publish changes</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Publish the latest draft?</AlertDialogTitle>
          <AlertDialogDescription>
            Collaborators will immediately see the new workflow. You can still revert from version
            history.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancelButton variant="secondary">Not now</AlertDialogCancelButton>
          <AlertDialogConfirmButton tone="default" onClick={() => actionsRef.current?.close()}>
            Publish
          </AlertDialogConfirmButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export const NonDestructive: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'A must-confirm decision that is not destructive keeps the alert semantics and uses `tone="default"` on the confirm.',
      },
    },
  },
  render: () => <NonDestructiveDemo />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)

    await userEvent.click(canvas.getByRole('button', { name: 'Publish changes' }))
    const dialog = await body.findByRole('alertdialog', { name: 'Publish the latest draft?' })
    await waitFor(async () => {
      await expect(dialog).toBeVisible()
    })

    await userEvent.click(within(dialog).getByRole('button', { name: 'Publish' }))
    await waitFor(async () => {
      await expect(body.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
  },
}

function PendingConfirmDemo() {
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const confirmLabelId = React.useId()

  function archive() {
    setPending(true)
    window.setTimeout(() => {
      setPending(false)
      setOpen(false)
    }, 1200)
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen, details) => {
        if (!nextOpen && pending) {
          details.cancel()
          return
        }
        setOpen(nextOpen)
      }}
    >
      <AlertDialogTrigger render={<Button variant="secondary" />}>
        Archive workspace
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive this workspace?</AlertDialogTitle>
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
            onClick={archive}
          >
            <span id={confirmLabelId}>{pending ? 'Archiving…' : 'Archive'}</span>
          </AlertDialogConfirmButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export const PendingConfirm: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'While the confirm is `loading`, Cancel is disabled and `onOpenChange` cancels Escape; the dialog closes itself once the action settles.',
      },
    },
  },
  render: () => <PendingConfirmDemo />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)

    await userEvent.click(canvas.getByRole('button', { name: 'Archive workspace' }))
    const dialog = await body.findByRole('alertdialog', { name: 'Archive this workspace?' })
    await waitFor(async () => {
      await expect(dialog).toBeVisible()
    })
    const confirmButton = within(dialog).getByRole('button', { name: 'Archive' })
    await userEvent.click(confirmButton)
    await waitFor(async () => {
      await expect(confirmButton).toHaveAccessibleName('Archiving…')
    })
    await expect(confirmButton).toHaveFocus()

    await userEvent.keyboard('{Escape}')
    await expect(dialog).toHaveAttribute('data-open')

    await waitFor(
      async () => {
        await expect(body.queryByRole('alertdialog')).not.toBeInTheDocument()
      },
      { timeout: 3000 },
    )
  },
}

type ApiKeyPayload = {
  name: string
}

const apiKeys = [
  { name: 'Production' },
  { name: 'Staging' },
] as const satisfies readonly ApiKeyPayload[]

function DetachedTriggersDemo() {
  const [dialogHandle] = React.useState(() => createAlertDialogHandle<ApiKeyPayload>())

  return (
    <React.Fragment>
      <ul className="flex w-96 flex-col divide-y divide-divider-subtle">
        {apiKeys.map((apiKey) => (
          <li key={apiKey.name} className="flex items-center justify-between gap-4 py-2">
            <span className="system-sm-medium text-text-primary">{apiKey.name}</span>
            <AlertDialogTrigger
              handle={dialogHandle}
              payload={apiKey}
              render={<Button size="small" variant="ghost" tone="destructive" />}
            >
              Delete {apiKey.name}
            </AlertDialogTrigger>
          </li>
        ))}
      </ul>
      <AlertDialog handle={dialogHandle}>
        {({ payload }) => (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete the {payload?.name} key?</AlertDialogTitle>
              <AlertDialogDescription>
                Requests signed with this key will start failing immediately.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancelButton variant="secondary">Cancel</AlertDialogCancelButton>
              <AlertDialogConfirmButton onClick={() => dialogHandle.close()}>
                Delete
              </AlertDialogConfirmButton>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </React.Fragment>
  )
}

export const DetachedTriggers: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'One alert dialog serves every row: each Delete is an `AlertDialogTrigger` bound to a `createAlertDialogHandle` with its row as `payload`.',
      },
    },
  },
  render: () => <DetachedTriggersDemo />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)

    await userEvent.click(canvas.getByRole('button', { name: 'Delete Staging' }))
    const dialog = await body.findByRole('alertdialog', { name: 'Delete the Staging key?' })
    await waitFor(async () => {
      await expect(dialog).toBeVisible()
    })

    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(async () => {
      await expect(body.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    await expect(canvas.getByRole('button', { name: 'Delete Staging' })).toHaveFocus()
  },
}

export const LongObjectName: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'A user-named object wraps in the title, and a description with a line break keeps it.',
      },
    },
  },
  render: () => (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="secondary" tone="destructive" />}>
        Delete knowledge base
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete “Customer support escalation playbook for enterprise accounts (2026 Q3)”?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {
              'Documents, segments, and retrieval settings will be removed.\nApps that use this knowledge base will stop retrieving from it.'
            }
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancelButton variant="secondary">Cancel</AlertDialogCancelButton>
          <AlertDialogConfirmButton>Delete</AlertDialogConfirmButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ),
}
