import type { Meta, StoryObj } from '@storybook/react-vite'
import * as React from 'react'
import { expect, waitFor, within } from 'storybook/test'
import {
  createDialogHandle,
  Dialog,
  DialogBackdrop,
  DialogBody,
  DialogClose,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  DialogViewport,
} from '.'
import { Button } from '../button'
import { Field, FieldDescription, FieldError, FieldLabel } from '../field'
import { Form } from '../form'
import { IconButton } from '../icon-button'
import { Input } from '../input'
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '../scroll-area'

const meta = {
  title: 'Base/UI/Dialog',
  component: Dialog,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Compound modal dialog built on Base UI Dialog. Use it for focused flows that interrupt the user, such as editing settings, confirming non-destructive actions, or collecting short-form input. Compose `DialogHeader`, `DialogBody` and `DialogFooter` inside `DialogContent`; the parts own the spacing, so call sites only arrange their content. `DialogCloseButton` is the header close icon; `DialogClose` stays unstyled for visible actions such as Cancel.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof Dialog>

export default meta
type Story = StoryObj<typeof meta>

const releaseNoteItems = Array.from({ length: 24 }, (_, index) => ({
  id: `improvement-${index + 1}`,
  title: `Improvement #${index + 1}`,
  body: 'Refined a workflow behavior so long content naturally overflows and scrolls inside the dialog.',
}))

function ReleaseNoteSections() {
  return (
    <DialogBody className="flex flex-col gap-3">
      {releaseNoteItems.map((item) => (
        <section
          key={item.id}
          className="rounded-lg bg-background-default-subtle px-3 py-2 system-sm-regular text-text-secondary"
        >
          <h3 className="system-sm-medium text-text-primary">{item.title}</h3>
          <p>{item.body}</p>
        </section>
      ))}
    </DialogBody>
  )
}

export const Default: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger render={<Button />}>Open dialog</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite collaborators</DialogTitle>
          <DialogDescription>
            Add teammates by email to share this workspace. They will receive an invitation link.
          </DialogDescription>
          <DialogCloseButton aria-label="Close dialog" />
        </DialogHeader>
        <DialogBody>
          <Field name="email">
            <FieldLabel>Email address</FieldLabel>
            <Input type="email" placeholder="teammate@example.com" />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="primary">Send invite</Button>
        </DialogFooter>
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

    await userEvent.click(body.getByRole('button', { name: 'Close dialog' }))
    await waitFor(async () => {
      await expect(
        body.queryByRole('dialog', { name: 'Invite collaborators' }),
      ).not.toBeInTheDocument()
    })
  },
}

export const WithoutCloseButton: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger render={<Button />}>Start onboarding</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Welcome to Dify</DialogTitle>
          <DialogDescription>
            Let's get your workspace ready. This takes about a minute and sets up your default
            models, datasets, and API keys.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button />}>Skip for now</DialogClose>
          <Button variant="primary">Start setup</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}

function ControlledDemo() {
  const [open, setOpen] = React.useState(false)

  return (
    <div className="flex flex-col items-center gap-3">
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Open controlled dialog
      </Button>
      <span className="text-xs text-text-tertiary">State: {open ? 'open' : 'closed'}</span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename workspace</DialogTitle>
            <DialogDescription>
              The workspace URL will stay the same, but the display name updates everywhere.
            </DialogDescription>
            <DialogCloseButton aria-label="Close dialog" />
          </DialogHeader>
          <DialogBody>
            <Field name="name">
              <FieldLabel>Workspace name</FieldLabel>
              <Input type="text" defaultValue="Acme Workspace" />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => setOpen(false)}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export const Controlled: Story = {
  render: () => <ControlledDemo />,
}

type WorkspaceDialogPayload = {
  name: string
  memberCount: number
}

const workspaceDialogPayloads = [
  { name: 'Design', memberCount: 8 },
  { name: 'Engineering', memberCount: 24 },
] as const satisfies readonly WorkspaceDialogPayload[]

function DetachedTriggersDemo() {
  const [dialogHandle] = React.useState(() => createDialogHandle<WorkspaceDialogPayload>())

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex gap-2">
        {workspaceDialogPayloads.map((payload) => (
          <DialogTrigger
            key={payload.name}
            handle={dialogHandle}
            payload={payload}
            render={<Button variant="secondary" />}
          >
            Edit {payload.name}
          </DialogTrigger>
        ))}
      </div>

      <Dialog handle={dialogHandle}>
        {({ payload }) => (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{payload ? `Edit ${payload.name}` : 'Edit workspace'}</DialogTitle>
              <DialogDescription>
                {payload
                  ? `${payload.memberCount} members currently have access to this workspace.`
                  : 'Choose a workspace to edit.'}
              </DialogDescription>
              <DialogCloseButton aria-label="Close dialog" />
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button variant="primary" />}>Done</DialogClose>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  )
}

export const DetachedTriggers: Story = {
  render: () => <DetachedTriggersDemo />,
}

type ApiExtensionFormValues = {
  name: string
  endpoint: string
  apiKey: string
}

function FormDialogDemo() {
  const [open, setOpen] = React.useState(false)
  const nameInputRef = React.useRef<HTMLInputElement>(null)

  return (
    <Dialog open={open} onOpenChange={setOpen} disablePointerDismissal>
      <DialogTrigger render={<Button />}>Configure API extension</DialogTrigger>
      <DialogContent
        initialFocus={nameInputRef}
        className="w-160"
        backdropProps={{ forceRender: true }}
      >
        <DialogHeader>
          <DialogTitle>Configure API extension</DialogTitle>
          <DialogDescription>
            Save the endpoint and credentials used by this workspace integration.
          </DialogDescription>
          <DialogCloseButton aria-label="Close dialog" />
        </DialogHeader>
        <Form<ApiExtensionFormValues> onFormSubmit={() => setOpen(false)}>
          <DialogBody className="flex flex-col gap-4">
            <Field name="name">
              <FieldLabel>Name</FieldLabel>
              <Input ref={nameInputRef} required placeholder="Production API" />
              <FieldError match="valueMissing">Name is required.</FieldError>
            </Field>
            <Field name="endpoint">
              <FieldLabel>Endpoint</FieldLabel>
              <Input type="url" required placeholder="https://api.example.com" />
              <FieldDescription>
                <a
                  href="https://docs.dify.ai/use-dify/workspace/api-extension/api-extension"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex w-fit items-center text-text-accent underline decoration-text-accent/60 decoration-1 underline-offset-2 outline-hidden hover:decoration-text-accent focus-visible:rounded-xs focus-visible:no-underline focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                >
                  View API extension docs
                </a>
              </FieldDescription>
              <FieldError match="valueMissing">Endpoint is required.</FieldError>
              <FieldError match="typeMismatch">Enter a valid URL.</FieldError>
            </Field>
            <Field
              name="apiKey"
              validate={(value) => {
                if (typeof value === 'string' && value.length > 0 && value.length < 5)
                  return 'API key must be at least 5 characters.'

                return null
              }}
            >
              <FieldLabel>API key</FieldLabel>
              <Input required placeholder="sk-..." />
              <FieldError match="valueMissing">API key is required.</FieldError>
              <FieldError match="customError" />
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button />}>Cancel</DialogClose>
            <Button type="submit" variant="primary">
              Save
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

export const FormDialog: Story = {
  render: () => <FormDialogDemo />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)

    await userEvent.click(canvas.getByRole('button', { name: 'Configure API extension' }))

    await waitFor(async () => {
      await expect(body.getByRole('textbox', { name: 'Name' })).toHaveFocus()
    })
  },
}

function OutsideScrollingContentDemo() {
  const [open, setOpen] = React.useState(false)
  const popupRef = React.useRef<HTMLDivElement>(null)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>Review long release notes</DialogTrigger>
      <DialogPortal>
        <DialogBackdrop className="duration-600 ease-[cubic-bezier(0.22,1,0.36,1)] data-ending-style:duration-350 data-ending-style:ease-[cubic-bezier(0.375,0.015,0.545,0.455)]" />
        <DialogViewport className="group/dialog">
          <ScrollArea className="h-full group-data-ending-style/dialog:pointer-events-none">
            <ScrollAreaViewport
              aria-label="Scrollable dialog viewport"
              role="region"
              className="overscroll-contain group-data-ending-style/dialog:pointer-events-none"
            >
              <ScrollAreaContent className="flex min-h-full items-center justify-center px-4 py-16">
                <DialogPopup
                  ref={popupRef}
                  initialFocus={popupRef}
                  className="relative mx-auto flex w-120 max-w-[calc(100vw-2rem)] flex-col overflow-hidden outline-hidden transition-[translate] duration-700 ease-[cubic-bezier(0.45,1.005,0,1.005)] data-ending-style:translate-y-[max(100dvh,100%)] data-ending-style:scale-100 data-ending-style:opacity-100 data-ending-style:duration-350 data-ending-style:ease-[cubic-bezier(0.375,0.015,0.545,0.455)] data-starting-style:translate-y-[100dvh] data-starting-style:scale-100 data-starting-style:opacity-100"
                >
                  <DialogHeader>
                    <DialogTitle>Long release notes</DialogTitle>
                    <DialogDescription>
                      This layout lets the outer dialog viewport scroll while the popup keeps its
                      natural height.
                    </DialogDescription>
                    <DialogCloseButton aria-label="Close dialog" />
                  </DialogHeader>
                  <ReleaseNoteSections />
                  <DialogFooter>
                    <DialogClose render={<Button />}>Close</DialogClose>
                  </DialogFooter>
                </DialogPopup>
              </ScrollAreaContent>
            </ScrollAreaViewport>
            <ScrollAreaScrollbar>
              <ScrollAreaThumb />
            </ScrollAreaScrollbar>
          </ScrollArea>
        </DialogViewport>
      </DialogPortal>
    </Dialog>
  )
}

export const OutsideScrollingContent: Story = {
  render: () => <OutsideScrollingContentDemo />,
}

export const OutsidePopupElements: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger render={<Button />}>Open uncontained dialog</DialogTrigger>
      <DialogPortal>
        <DialogBackdrop className="min-h-dvh" />
        <DialogViewport className="grid place-items-center px-4 py-12 xl:py-6">
          <DialogPopup className="group/popup pointer-events-none relative flex h-full w-full max-w-280 justify-center border-0 bg-transparent shadow-none transition-opacity data-ending-style:scale-100 data-ending-style:opacity-0 data-starting-style:scale-100 data-starting-style:opacity-0">
            <DialogClose
              render={
                <IconButton
                  aria-label="Close"
                  size="lg"
                  className="pointer-events-auto absolute -top-10 right-0 z-10 flex items-center justify-center border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg text-text-tertiary shadow-xs outline-hidden hover:bg-components-button-secondary-bg-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid xl:top-0"
                >
                  <span aria-hidden className="i-ri-close-line size-4" />
                </IconButton>
              }
            />
            <div className="pointer-events-auto flex h-full w-full max-w-280 flex-col overflow-hidden rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-6 shadow-xl transition-[scale] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-data-starting-style/popup:scale-105">
              <div className="grid gap-2">
                <DialogTitle className="text-lg leading-7 font-semibold text-text-primary">
                  Knowledge review
                </DialogTitle>
                <DialogDescription className="text-sm leading-5 text-text-secondary">
                  The close button is visually outside this panel but remains inside the popup for
                  focus order and screen reader context.
                </DialogDescription>
              </div>
              <div className="mt-6 grid flex-1 place-items-center rounded-xl bg-background-default-subtle text-sm text-text-tertiary">
                Panel content
              </div>
            </div>
          </DialogPopup>
        </DialogViewport>
      </DialogPortal>
    </Dialog>
  ),
}

function InsideScrollingContentDemo() {
  const [open, setOpen] = React.useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>Review release notes</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Release notes</DialogTitle>
          <DialogDescription>Highlights from the latest workspace update.</DialogDescription>
          <DialogCloseButton aria-label="Close dialog" />
        </DialogHeader>
        <ReleaseNoteSections />
        <DialogFooter>
          <DialogClose render={<Button />}>Close</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export const InsideScrollingContent: Story = {
  render: () => <InsideScrollingContentDemo />,
}
