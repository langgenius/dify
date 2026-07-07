import type { Meta, StoryObj } from '@storybook/react-vite'
import * as React from 'react'
import { expect, waitFor, within } from 'storybook/test'
import {
  Dialog,
  DialogBackdrop,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  DialogViewport,
} from '.'
import { Button } from '../button'
import { FieldControl, FieldDescription, FieldError, FieldLabel, FieldRoot } from '../field'
import { Form } from '../form'
import { Input } from '../input'
import {
  ScrollAreaContent,
  ScrollAreaRoot,
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
        component: 'Compound modal dialog built on Base UI Dialog. Use it for focused flows that interrupt the user, such as editing settings, confirming non-destructive actions, or collecting short-form input. Compose `DialogTitle`, `DialogDescription`, and optional `DialogCloseButton` inside `DialogContent`.',
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

function ReleaseNoteHeader({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="flex shrink-0 flex-col gap-2 p-6 pr-12 pb-4">
      <DialogTitle className="text-lg leading-7 font-semibold text-text-primary">
        {title}
      </DialogTitle>
      <DialogDescription className="text-sm leading-5 text-text-secondary">
        {description}
      </DialogDescription>
    </div>
  )
}

function ReleaseNoteSections() {
  return (
    <div className="flex flex-col gap-3 px-6 py-2 text-sm leading-5 text-text-secondary">
      {releaseNoteItems.map(item => (
        <section key={item.id} className="rounded-lg bg-background-default-subtle px-3 py-2">
          <h3 className="font-medium text-text-primary">
            {item.title}
          </h3>
          <p>{item.body}</p>
        </section>
      ))}
    </div>
  )
}

function ReleaseNoteFooter({
  onClose,
}: {
  onClose: () => void
}) {
  return (
    <div className="flex shrink-0 justify-end border-t border-divider-subtle p-4">
      <Button onClick={onClose}>
        Close
      </Button>
    </div>
  )
}

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

const OutsideScrollingContentDemo = () => {
  const [open, setOpen] = React.useState(false)
  const popupRef = React.useRef<HTMLDivElement>(null)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button />}
      >
        Review long release notes
      </DialogTrigger>
      <DialogPortal>
        <DialogBackdrop className="duration-[600ms] ease-[cubic-bezier(0.22,1,0.36,1)] data-ending-style:duration-[350ms] data-ending-style:ease-[cubic-bezier(0.375,0.015,0.545,0.455)]" />
        <DialogViewport className="group/dialog">
          <ScrollAreaRoot className="h-full overscroll-contain group-data-ending-style/dialog:pointer-events-none">
            <ScrollAreaViewport aria-label="Scrollable dialog viewport" role="region" className="h-full max-h-full max-w-full overscroll-contain group-data-ending-style/dialog:pointer-events-none">
              <ScrollAreaContent className="flex min-h-full items-center justify-center px-4 py-16">
                <DialogPopup
                  ref={popupRef}
                  initialFocus={popupRef}
                  className="relative mx-auto flex w-120 max-w-[calc(100vw-2rem)] flex-col overflow-hidden outline-hidden transition-[translate] duration-[700ms] ease-[cubic-bezier(0.45,1.005,0,1.005)] data-starting-style:translate-y-[100dvh] data-starting-style:scale-100 data-starting-style:opacity-100 data-ending-style:translate-y-[max(100dvh,100%)] data-ending-style:scale-100 data-ending-style:opacity-100 data-ending-style:duration-[350ms] data-ending-style:ease-[cubic-bezier(0.375,0.015,0.545,0.455)]"
                >
                  <DialogCloseButton />
                  <ReleaseNoteHeader
                    title="Long release notes"
                    description="This layout lets the outer dialog viewport scroll while the popup keeps its natural height."
                  />
                  <ReleaseNoteSections />
                  <ReleaseNoteFooter onClose={() => setOpen(false)} />
                </DialogPopup>
              </ScrollAreaContent>
            </ScrollAreaViewport>
            <ScrollAreaScrollbar>
              <ScrollAreaThumb />
            </ScrollAreaScrollbar>
          </ScrollAreaRoot>
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
      <DialogTrigger
        render={<Button />}
      >
        Open uncontained dialog
      </DialogTrigger>
      <DialogPortal>
        <DialogBackdrop className="min-h-dvh" />
        <DialogViewport className="grid place-items-center px-4 py-12 xl:py-6">
          <DialogPopup className="group/popup relative flex h-full w-full max-w-[70rem] justify-center border-0 bg-transparent shadow-none pointer-events-none transition-opacity data-starting-style:scale-100 data-starting-style:opacity-0 data-ending-style:scale-100 data-ending-style:opacity-0">
            <DialogCloseButton
              aria-label="Close"
              className="pointer-events-auto absolute right-0 -top-10 z-10 flex size-8 items-center justify-center rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg text-text-tertiary shadow-xs outline-hidden hover:bg-components-button-secondary-bg-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid xl:top-0"
            >
            </DialogCloseButton>
            <div className="pointer-events-auto flex h-full w-full max-w-[70rem] flex-col overflow-hidden rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-6 shadow-xl transition-[scale] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-data-starting-style/popup:scale-105">
              <div className="grid gap-2">
                <DialogTitle className="text-lg leading-7 font-semibold text-text-primary">
                  Knowledge review
                </DialogTitle>
                <DialogDescription className="text-sm leading-5 text-text-secondary">
                  The close button is visually outside this panel but remains inside the popup for focus order and screen reader context.
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

const InsideScrollingContentDemo = () => {
  const [open, setOpen] = React.useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button />}
      >
        Review release notes
      </DialogTrigger>
      <DialogPortal>
        <DialogBackdrop />
        <DialogViewport className="flex items-center justify-center overflow-hidden p-4">
          <DialogPopup
            className="relative flex h-[min(44rem,calc(100dvh-2rem))] w-120 max-w-[calc(100vw-2rem)] min-h-0 flex-col overflow-hidden"
          >
            <DialogCloseButton />
            <ReleaseNoteHeader
              title="Release notes"
              description="Highlights from the latest workspace update."
            />
            <ScrollAreaRoot className="relative flex min-h-0 flex-auto overflow-hidden">
              <ScrollAreaViewport aria-label="Release note improvements" role="region" className="h-full max-h-full max-w-full overflow-y-auto overscroll-contain">
                <ScrollAreaContent>
                  <ReleaseNoteSections />
                </ScrollAreaContent>
              </ScrollAreaViewport>
              <ScrollAreaScrollbar>
                <ScrollAreaThumb />
              </ScrollAreaScrollbar>
            </ScrollAreaRoot>
            <ReleaseNoteFooter onClose={() => setOpen(false)} />
          </DialogPopup>
        </DialogViewport>
      </DialogPortal>
    </Dialog>
  )
}

export const InsideScrollingContent: Story = {
  render: () => <InsideScrollingContentDemo />,
}
