import type { Meta, StoryObj } from '@storybook/react-vite'
import type { DialogActions } from '.'
import * as React from 'react'
import { expect, waitFor, within } from 'storybook/test'
import {
  createDialogHandle,
  Dialog,
  DialogBackdrop,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  DialogViewport,
} from '.'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../alert-dialog'
import { Button } from '../button'
import { Field, FieldError, FieldLabel } from '../field'
import { Form } from '../form'
import { Input } from '../input'
import { Textarea } from '../textarea'

const meta = {
  title: 'Base/UI/Dialog',
  component: Dialog,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: [
          'Compound modal dialog built on Base UI Dialog. Use it for focused flows that interrupt the user, such as editing settings, collecting short-form input, or inspecting a record. `DialogContent` is the centered modal surface: compose `DialogHeader`, `DialogBody` and `DialogFooter` in it and the parts own the spacing, so a call site only arranges its content. `DialogBody` scrolls between the header and footer when the surface reaches the viewport.',
          '',
          'Open state is uncontrolled by default; pass `open` and `onOpenChange` to close after an async action or to veto a close through `eventDetails.cancel()`. `DialogHeaderCloseButton` belongs inside `DialogHeader`, which reserves space for the optional close icon; `DialogClose` stays unstyled and composes a visible action such as Cancel. `DialogPopup` is the bare dialog element for a surface that places and dresses itself, composed with `DialogPortal`, `DialogBackdrop` and `DialogViewport`.',
        ].join('\n'),
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof Dialog>

export default meta
type Story = StoryObj<typeof meta>

const panelClassName =
  'rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl'

const releaseNotes = Array.from({ length: 24 }, (_, index) => ({
  id: `improvement-${index + 1}`,
  title: `Improvement #${index + 1}`,
  body: 'Refined a workflow behavior so long content naturally overflows and scrolls inside the dialog.',
}))

function ReleaseNoteList() {
  return (
    <ol className="flex flex-col gap-3">
      {releaseNotes.map((note) => (
        <li
          key={note.id}
          className="rounded-lg bg-background-default-subtle px-3 py-2 system-sm-regular text-text-secondary"
        >
          <h3 className="system-sm-medium text-text-primary">{note.title}</h3>
          <p>{note.body}</p>
        </li>
      ))}
    </ol>
  )
}

export const Default: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger render={<Button />}>Start onboarding</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Welcome to Dify</DialogTitle>
          <DialogDescription>
            Setup takes about a minute and prepares your default models, datasets and API keys.
          </DialogDescription>
          <DialogHeaderCloseButton aria-label="Close dialog" />
        </DialogHeader>
        <DialogBody>
          <ol className="list-inside list-decimal space-y-1 system-sm-regular text-text-secondary">
            <li>Connect a model provider</li>
            <li>Import your first knowledge base</li>
            <li>Create an API key for your app</li>
          </ol>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>Skip for now</DialogClose>
          <Button variant="primary">Start setup</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)

    await userEvent.click(canvas.getByRole('button', { name: 'Start onboarding' }))
    const dialog = await body.findByRole('dialog', { name: 'Welcome to Dify' })
    await waitFor(async () => {
      await expect(dialog).toBeVisible()
    })
    await expect(dialog).toHaveAccessibleDescription(/Setup takes about a minute/)

    await userEvent.click(body.getByRole('button', { name: 'Skip for now' }))
    await waitFor(async () => {
      await expect(body.queryByRole('dialog')).not.toBeInTheDocument()
    })
    await expect(canvas.getByRole('button', { name: 'Start onboarding' })).toHaveFocus()
  },
}

type ApiExtensionFormValues = {
  name: string
  endpoint: string
}

class ApiExtensionRequestError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.code = code
  }
}

function saveApiExtension({ name, endpoint }: ApiExtensionFormValues) {
  return new Promise<void>((resolve, reject) => {
    setTimeout(() => {
      if (name === 'Production API') reject(new ApiExtensionRequestError('name_taken'))
      else if (endpoint.includes('unreachable')) reject(new ApiExtensionRequestError('unknown'))
      else resolve()
    }, 300)
  })
}

// Stable so `Form` re-applies the error only when the code changes, not on every render.
const NAME_TAKEN_ERRORS = { name: 'An extension with this name already exists.' }

function FormDialogDemo() {
  const actionsRef = React.useRef<DialogActions>(null)
  const nameInputRef = React.useRef<HTMLInputElement>(null)
  const [isPending, startTransition] = React.useTransition()

  return (
    <Dialog
      actionsRef={actionsRef}
      disablePointerDismissal
      onOpenChange={(open, details) => {
        if (!open && isPending && details.reason !== 'imperative-action') details.cancel()
      }}
    >
      <DialogTrigger render={<Button />}>Add API extension</DialogTrigger>
      <DialogContent initialFocus={nameInputRef}>
        <DialogHeader>
          <DialogTitle>Add API extension</DialogTitle>
          <DialogDescription>
            Save the endpoint this workspace calls for external data tools.
          </DialogDescription>
          <DialogHeaderCloseButton aria-label="Close dialog" />
        </DialogHeader>
        <ApiExtensionForm
          nameInputRef={nameInputRef}
          isPending={isPending}
          startTransition={startTransition}
          onSaved={() => actionsRef.current?.close()}
        />
      </DialogContent>
    </Dialog>
  )
}

function ApiExtensionForm({
  nameInputRef,
  isPending,
  startTransition,
  onSaved,
}: {
  nameInputRef: React.RefObject<HTMLInputElement | null>
  isPending: boolean
  startTransition: React.TransitionStartFunction
  onSaved: () => void
}) {
  const [errorCode, setErrorCode] = React.useState<string | null>(null)
  const fieldErrors = errorCode === 'name_taken' ? NAME_TAKEN_ERRORS : undefined

  const handleSubmit = (values: ApiExtensionFormValues) => {
    setErrorCode(null)
    startTransition(async () => {
      try {
        await saveApiExtension(values)
        onSaved()
      } catch (error) {
        setErrorCode(error instanceof ApiExtensionRequestError ? error.code : 'unknown')
      }
    })
  }

  return (
    <Form<ApiExtensionFormValues>
      className="contents"
      errors={fieldErrors}
      onFormSubmit={handleSubmit}
    >
      <DialogBody className="flex flex-col gap-4">
        <Field
          name="name"
          validate={(value) =>
            typeof value === 'string' && value.trim() ? null : 'Name is required.'
          }
        >
          <FieldLabel>Name</FieldLabel>
          <Input
            ref={nameInputRef}
            aria-required
            readOnly={isPending}
            autoComplete="off"
            placeholder="Production API"
          />
          <FieldError />
        </Field>
        <Field name="endpoint">
          <FieldLabel>Endpoint</FieldLabel>
          <Input
            type="url"
            required
            readOnly={isPending}
            autoComplete="off"
            spellCheck={false}
            placeholder="https://api.example.com"
          />
          <FieldError match="valueMissing">Endpoint is required.</FieldError>
          <FieldError match="typeMismatch">Enter a valid URL.</FieldError>
        </Field>
        {errorCode && !fieldErrors && (
          <p role="alert" className="body-xs-regular text-text-destructive">
            Couldn’t save the extension. Try again.
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <DialogClose render={<Button />}>Cancel</DialogClose>
        <Button type="submit" variant="primary" loading={isPending}>
          Save
        </Button>
      </DialogFooter>
    </Form>
  )
}

export const FormDialog: Story = {
  parameters: {
    docs: {
      description: {
        story:
          '`initialFocus` lands on the first field and `disablePointerDismissal` keeps typed input safe from a stray outside click. Enter or the submit button runs `onFormSubmit`; while the save is pending the button shows `loading`, the fields are read-only, and `onOpenChange` cancels every close except the `actionsRef` close on success. A failed save maps its error code to a field through `Form` `errors`, which focuses that field and clears on edit; an unmapped code shows a form-level alert. The form and its error state live inside the popup, so they reset when it unmounts on close. Save "Production API" to see the field error, or an endpoint containing "unreachable" to see the alert.',
      },
    },
  },
  render: () => <FormDialogDemo />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    const trigger = canvas.getByRole('button', { name: 'Add API extension' })

    await userEvent.click(trigger)
    const dialog = await body.findByRole('dialog', { name: 'Add API extension' })
    const nameInput = within(dialog).getByRole('textbox', { name: 'Name' })
    await waitFor(async () => {
      await expect(nameInput).toHaveFocus()
    })

    await userEvent.type(nameInput, 'Production API')
    await userEvent.click(canvasElement.ownerDocument.body)
    await expect(dialog).toHaveAttribute('data-open')
    await expect(nameInput).toHaveValue('Production API')

    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Endpoint' }),
      'https://api.example.com',
    )
    await userEvent.keyboard('{Enter}')
    const saveButton = within(dialog).getByRole('button', { name: 'Save' })
    await expect(saveButton).toHaveAttribute('aria-disabled', 'true')
    await userEvent.keyboard('{Escape}')
    await expect(dialog).toHaveAttribute('data-open')

    await expect(
      await within(dialog).findByText('An extension with this name already exists.'),
    ).toBeVisible()
    await expect(nameInput).toHaveAttribute('aria-invalid', 'true')
    await expect(nameInput).toHaveFocus()

    await userEvent.keyboard('Staging API')
    await expect(
      within(dialog).queryByText('An extension with this name already exists.'),
    ).not.toBeInTheDocument()
    await userEvent.keyboard('{Enter}')
    await waitFor(async () => {
      await expect(body.queryByRole('dialog')).not.toBeInTheDocument()
    })
    await expect(trigger).toHaveFocus()

    await userEvent.click(trigger)
    const reopened = await body.findByRole('dialog', { name: 'Add API extension' })
    await expect(within(reopened).getByRole('textbox', { name: 'Name' })).toHaveValue('')
    await expect(within(reopened).queryByRole('alert')).not.toBeInTheDocument()
  },
}

export const ScrollingBody: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Long content scrolls inside `DialogBody` while the header and footer stay put; the surface is capped at the viewport height.',
      },
    },
  },
  render: () => (
    <Dialog>
      <DialogTrigger render={<Button />}>Review release notes</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Release notes</DialogTitle>
          <DialogDescription>Highlights from the latest workspace update.</DialogDescription>
          <DialogHeaderCloseButton aria-label="Close dialog" />
        </DialogHeader>
        <DialogBody role="region" aria-label="Release notes" tabIndex={0}>
          <ReleaseNoteList />
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>Close</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)

    await userEvent.click(canvas.getByRole('button', { name: 'Review release notes' }))
    const dialog = await body.findByRole('dialog', { name: 'Release notes' })
    const region = within(dialog).getByRole('region', { name: 'Release notes' })
    await waitFor(async () => {
      await expect(region.scrollHeight).toBeGreaterThan(region.clientHeight)
    })
    await expect(dialog.scrollHeight).toBe(dialog.clientHeight)

    region.scrollTop = region.scrollHeight
    await expect(region.scrollTop).toBeGreaterThan(0)
    await expect(dialog.scrollTop).toBe(0)
  },
}

export const ViewportScrolling: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'The popup keeps its natural height and `DialogViewport` scrolls instead; `DialogPopup` dresses itself because the centered `DialogContent` surface is not used.',
      },
    },
  },
  render: () => (
    <Dialog>
      <DialogTrigger render={<Button />}>Read the full changelog</DialogTrigger>
      <DialogPortal>
        <DialogBackdrop />
        <DialogViewport className="overflow-y-auto">
          <DialogPopup className={`${panelClassName} mx-auto my-16 w-120 max-w-[calc(100vw-2rem)]`}>
            <DialogHeader>
              <DialogTitle>Changelog</DialogTitle>
              <DialogDescription>
                Every improvement shipped since the last release.
              </DialogDescription>
              <DialogHeaderCloseButton aria-label="Close dialog" />
            </DialogHeader>
            <DialogBody>
              <ReleaseNoteList />
            </DialogBody>
            <DialogFooter>
              <DialogClose render={<Button />}>Close</DialogClose>
            </DialogFooter>
          </DialogPopup>
        </DialogViewport>
      </DialogPortal>
    </Dialog>
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)

    await userEvent.click(canvas.getByRole('button', { name: 'Read the full changelog' }))
    const dialog = await body.findByRole('dialog', { name: 'Changelog' })
    const viewport = dialog.parentElement as HTMLElement
    await waitFor(async () => {
      await expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight)
    })
    await expect(dialog.scrollHeight).toBe(dialog.clientHeight)
    await expect(dialog.getBoundingClientRect().top).toBeGreaterThan(0)

    viewport.scrollTop = viewport.scrollHeight
    await waitFor(async () => {
      await expect(dialog.getBoundingClientRect().top).toBeLessThan(0)
    })
    await expect(dialog.scrollTop).toBe(0)
  },
}

const traceRows = [
  ['LLM', '1.84s', '812 tokens'],
  ['Knowledge retrieval', '0.42s', '6 chunks'],
  ['Code', '0.08s', 'ok'],
  ['Answer', '0.01s', 'ok'],
] as const

export const SidePanel: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'A run-detail panel docked to the viewport edge, the way the log panels in web are built: `DialogPopup` places and dresses itself over a transparent `DialogBackdrop`.',
      },
    },
  },
  render: () => (
    <Dialog>
      <DialogTrigger render={<Button />}>View run detail</DialogTrigger>
      <DialogPortal>
        <DialogBackdrop className="bg-transparent" />
        <DialogPopup
          className={`${panelClassName} fixed inset-e-2 top-16 bottom-4 flex w-120 max-w-[calc(100vw-1rem)] flex-col overflow-hidden`}
        >
          <DialogHeader>
            <DialogTitle>Run detail</DialogTitle>
            <DialogDescription>Node executions for the selected message.</DialogDescription>
            <DialogHeaderCloseButton aria-label="Close panel" />
          </DialogHeader>
          <DialogBody>
            <table className="w-full system-sm-regular text-text-secondary">
              <thead className="system-xs-medium-uppercase text-text-tertiary">
                <tr>
                  <th scope="col" className="pb-2 text-start">
                    Node
                  </th>
                  <th scope="col" className="pb-2 text-start">
                    Elapsed
                  </th>
                  <th scope="col" className="pb-2 text-start">
                    Output
                  </th>
                </tr>
              </thead>
              <tbody>
                {traceRows.map(([node, elapsed, output]) => (
                  <tr key={node} className="border-t border-divider-subtle">
                    <td className="py-2 text-text-primary">{node}</td>
                    <td className="py-2">{elapsed}</td>
                    <td className="py-2">{output}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DialogBody>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    const trigger = canvas.getByRole('button', { name: 'View run detail' })

    await userEvent.click(trigger)
    const dialog = await body.findByRole('dialog', { name: 'Run detail' })
    await waitFor(async () => {
      await expect(dialog).toBeVisible()
    })
    await expect(trigger).toBeVisible()

    await userEvent.keyboard('{Escape}')
    await waitFor(async () => {
      await expect(body.queryByRole('dialog')).not.toBeInTheDocument()
    })
    await expect(trigger).toHaveFocus()
  },
}

type ApiKeyPayload = {
  name: string
  lastUsed: string
}

const apiKeys = [
  { name: 'Production', lastUsed: '2 minutes ago' },
  { name: 'Staging', lastUsed: '3 days ago' },
] as const satisfies readonly ApiKeyPayload[]

function DetachedTriggersDemo() {
  const [dialogHandle] = React.useState(() => createDialogHandle<ApiKeyPayload>())

  return (
    <React.Fragment>
      <ul className="flex w-96 flex-col divide-y divide-divider-subtle">
        {apiKeys.map((apiKey) => (
          <li key={apiKey.name} className="flex items-center justify-between gap-4 py-2">
            <span className="system-sm-medium text-text-primary">{apiKey.name}</span>
            <DialogTrigger
              handle={dialogHandle}
              payload={apiKey}
              render={<Button size="small" variant="secondary" />}
            >
              Edit {apiKey.name}
            </DialogTrigger>
          </li>
        ))}
      </ul>
      <Dialog handle={dialogHandle}>
        {({ payload }) => (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit {payload?.name} key</DialogTitle>
              <DialogDescription>Last used {payload?.lastUsed}.</DialogDescription>
              <DialogHeaderCloseButton aria-label="Close dialog" />
            </DialogHeader>
            <DialogBody>
              <Field name="name">
                <FieldLabel>Key name</FieldLabel>
                <Input defaultValue={payload?.name} />
              </Field>
            </DialogBody>
            <DialogFooter>
              <DialogClose render={<Button />}>Cancel</DialogClose>
              <Button variant="primary" onClick={() => dialogHandle.close()}>
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </React.Fragment>
  )
}

export const DetachedTriggers: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'One dialog serves a list of rows: each row is a `DialogTrigger` bound to a `createDialogHandle` with its row as `payload`, and the root renders from that payload.',
      },
    },
  },
  render: () => <DetachedTriggersDemo />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)

    await userEvent.click(canvas.getByRole('button', { name: 'Edit Staging' }))
    const dialog = await body.findByRole('dialog', { name: 'Edit Staging key' })
    await waitFor(async () => {
      await expect(dialog).toBeVisible()
    })
    await expect(within(dialog).getByRole('textbox', { name: 'Key name' })).toHaveValue('Staging')

    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(async () => {
      await expect(body.queryByRole('dialog')).not.toBeInTheDocument()
    })
    await expect(canvas.getByRole('button', { name: 'Edit Staging' })).toHaveFocus()
  },
}

function UnsavedChangesDemo() {
  const [open, setOpen] = React.useState(false)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [saved, setSaved] = React.useState('')
  const [draft, setDraft] = React.useState('')

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen, details) => {
        if (!nextOpen && draft !== saved) {
          details.cancel()
          setConfirmOpen(true)
          return
        }
        setOpen(nextOpen)
      }}
    >
      <DialogTrigger render={<Button />}>Edit description</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit description</DialogTitle>
          <DialogDescription>Shown on the app card and in the explore page.</DialogDescription>
          <DialogHeaderCloseButton aria-label="Close dialog" />
        </DialogHeader>
        <DialogBody>
          <Field name="description">
            <FieldLabel>Description</FieldLabel>
            <Textarea value={draft} onValueChange={setDraft} placeholder="What does this app do?" />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button
            variant="primary"
            onClick={() => {
              setSaved(draft)
              setOpen(false)
            }}
          >
            Save
          </Button>
        </DialogFooter>
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
              <AlertDialogDescription>
                Your edits to the description will be lost.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancelButton variant="secondary">Keep editing</AlertDialogCancelButton>
              <AlertDialogConfirmButton
                onClick={() => {
                  setConfirmOpen(false)
                  setDraft(saved)
                  setOpen(false)
                }}
              >
                Discard
              </AlertDialogConfirmButton>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  )
}

export const UnsavedChanges: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Closing a dirty dialog is vetoed with `eventDetails.cancel()` in `onOpenChange`, and a nested `AlertDialog` asks before the edits are discarded; the parent surface steps back and dims while the alert is open.',
      },
    },
  },
  render: () => <UnsavedChangesDemo />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)

    await userEvent.click(canvas.getByRole('button', { name: 'Edit description' }))
    const dialog = await body.findByRole('dialog', { name: 'Edit description' })
    const description = within(dialog).getByRole('textbox', { name: 'Description' })
    await userEvent.type(description, 'Answers support tickets')

    await userEvent.keyboard('{Escape}')
    const alert = await body.findByRole('alertdialog', { name: 'Discard unsaved changes?' })
    await waitFor(async () => {
      await expect(alert).toBeVisible()
    })
    await expect(dialog).toHaveAttribute('data-nested-dialog-open')

    await userEvent.click(within(alert).getByRole('button', { name: 'Keep editing' }))
    await waitFor(async () => {
      await expect(body.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    await expect(description).toHaveValue('Answers support tickets')

    await userEvent.keyboard('{Escape}')
    await userEvent.click(await body.findByRole('button', { name: 'Discard' }))
    await waitFor(async () => {
      await expect(body.queryByRole('dialog')).not.toBeInTheDocument()
    })
  },
}
