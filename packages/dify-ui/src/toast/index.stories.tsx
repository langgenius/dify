import type { StoryProps } from '@storybook/addon-docs/blocks'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ToastType } from '.'
import { ArgTypes, DocsContext, useOf } from '@storybook/addon-docs/blocks'
import * as React from 'react'
import { expect, waitFor, within } from 'storybook/test'
import { createToast, createToastManager, Toaster } from '.'
import { Button } from '../button'

type ToastExampleProps = {
  type: ToastType
  title: string
  description?: string
}

function ToastExample({ type, title, description }: ToastExampleProps) {
  const [manager] = React.useState(createToastManager)
  const toast = createToast(manager)

  return (
    <React.Fragment>
      <Toaster toastManager={manager} />
      <Button onClick={() => toast[type](title, { description })}>Show notification</Button>
    </React.Fragment>
  )
}

function ToastDocsPreview({ of, height }: StoryProps) {
  const context = React.useContext(DocsContext)
  const { story } = useOf(of ?? 'story', ['story'])
  const { globals } = context.getStoryContext(story)
  const params = new URLSearchParams({
    viewMode: 'story',
    id: story.id,
    embed: 'true',
    globals: `theme:${globals.theme}`,
  })

  // Storybook 10.6 ignores docs autoplay for iframe stories; embed mode skips play.
  return (
    <iframe
      title={story.name}
      src={`./iframe.html?${params}`}
      className="w-full border-0"
      height={height ?? '440px'}
    />
  )
}

const meta = {
  title: 'Base/UI/Toast',
  component: ToastExample,
  parameters: {
    layout: 'fullscreen',
    docs: {
      components: { Story: ToastDocsPreview, Controls: ArgTypes },
      canvas: { withToolbar: false },
      description: {
        component:
          'Create a manager with `createToastManager()`, pass it to `Toaster`, and use `createToast(manager)` to send notifications from outside the React tree. Each example owns its manager. `Toaster` supplies the Base UI provider, portal, viewport, and default cards; Base UI manages dismissal, timers, focus, and stacking state. Press F6 to enter or leave the notifications region. The default timeout is 5 seconds and the visible stack limit is 3. Lifecycle examples use `timeout={0}` so they remain available for inspection.',
      },
      story: { autoplay: false },
    },
  },
  decorators: [
    (Story) => (
      <div className="flex min-h-100 flex-wrap items-end gap-3 bg-background-default-subtle p-6">
        <Story />
      </div>
    ),
  ],
  argTypes: {
    type: { control: 'select', options: ['success', 'info', 'warning', 'error'] },
    title: { control: 'text' },
    description: { control: 'text' },
  },
  args: {
    type: 'success',
    title: 'Export complete',
    description: 'Your workflow is ready to download.',
  },
  play: async ({ args, canvas, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(canvas.getByRole('button', { name: 'Show notification' }))
    const notification = await body.findByRole('dialog', { name: args.title })
    await waitFor(() => expect(notification).toBeVisible())
    if (args.description) {
      await expect(within(notification).getByText(args.description)).toBeVisible()
    }
  },
} satisfies Meta<typeof ToastExample>

export default meta
type Story = StoryObj<typeof meta>

export const Success: Story = {}

export const Info: Story = {
  args: {
    type: 'info',
    title: 'Workflow restored',
    description: 'A collaborator restored an earlier version.',
  },
}

export const Warning: Story = {
  args: {
    type: 'warning',
    title: 'Import completed with warnings',
    description: 'Two unsupported files were skipped.',
  },
}

export const Error: Story = {
  args: {
    type: 'error',
    title: 'Export failed',
    description: 'The storage service is unavailable. Try again later.',
  },
}

function StackedExample() {
  const [manager] = React.useState(createToastManager)
  const toast = createToast(manager)
  const countRef = React.useRef(0)

  return (
    <React.Fragment>
      <Toaster toastManager={manager} timeout={0} limit={3} />
      <Button
        onClick={() => {
          countRef.current += 1
          toast.info(`Background task ${countRef.current} completed`)
        }}
      >
        Add notification
      </Button>
      <Button variant="secondary" onClick={() => toast.dismiss()}>
        Clear notifications
      </Button>
    </React.Fragment>
  )
}

export const Stacked: Story = {
  parameters: {
    controls: { disable: true },
    docs: {
      description: {
        story:
          'Add notifications repeatedly to inspect the three-item stack and overflow. Hover or focus the viewport to expand it; clear the stack to start again.',
      },
    },
  },
  render: () => <StackedExample />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    const add = canvas.getByRole('button', { name: 'Add notification' })
    await userEvent.click(add)
    await userEvent.click(add)
    await userEvent.click(add)
    await userEvent.hover(await body.findByRole('dialog', { name: 'Background task 3 completed' }))
    await expect(body.getAllByRole('dialog')).toHaveLength(3)
    for (const notification of body.getAllByRole('dialog')) {
      await expect(notification).toHaveAttribute('data-expanded')
    }
  },
}

function VaryingHeightsExample() {
  const [manager] = React.useState(createToastManager)
  const toast = createToast(manager)

  const showStack = () => {
    toast.error('Workflow could not be published', {
      id: 'publication',
      description:
        'Several dependent resources are unavailable. Check the model provider credentials, reconnect the knowledge base, and try publishing again after every dependency is ready.',
    })
    toast.success('Export complete', { id: 'export' })
  }

  return (
    <React.Fragment>
      <Toaster toastManager={manager} timeout={0} />
      <Button onClick={showStack}>Show different heights</Button>
    </React.Fragment>
  )
}

export const VaryingHeights: Story = {
  parameters: {
    controls: { disable: true },
    docs: {
      description: {
        story:
          'A tall notification sits behind a short one. The collapsed stack uses the front card’s height; hover or focus reveals each card at its own height.',
      },
    },
  },
  render: () => <VaryingHeightsExample />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(canvas.getByRole('button', { name: 'Show different heights' }))
    const front = await body.findByRole('dialog', { name: 'Export complete' })
    const behind = body.getByRole('dialog', { name: 'Workflow could not be published' })
    await waitFor(() => {
      expect(Math.abs(behind.clientHeight - front.clientHeight)).toBeLessThanOrEqual(1)
    })
    await userEvent.hover(front)
    await waitFor(() => expect(behind.clientHeight).toBeGreaterThan(front.clientHeight))
    await waitFor(() =>
      expect(within(behind).getByText(/Several dependent resources/)).toBeVisible(),
    )
  },
}

function ActionExample() {
  const [manager] = React.useState(createToastManager)
  const toast = createToast(manager)

  const archive = () => {
    const id = toast.success('Project archived', {
      description: 'You can restore the project with Undo.',
      actionProps: {
        children: 'Undo',
        onClick: () => {
          toast.dismiss(id)
          toast.success('Project restored')
        },
      },
    })
  }

  return (
    <React.Fragment>
      <Toaster toastManager={manager} timeout={0} />
      <Button onClick={archive}>Archive project</Button>
    </React.Fragment>
  )
}

export const WithAction: Story = {
  parameters: {
    controls: { disable: true },
    docs: {
      description: {
        story:
          'Use `actionProps` for a notification action. The caller closes the original notification when Undo completes.',
      },
    },
  },
  render: () => <ActionExample />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(canvas.getByRole('button', { name: 'Archive project' }))
    const archived = await body.findByRole('dialog', { name: 'Project archived' })
    await userEvent.click(within(archived).getByRole('button', { name: 'Undo' }))
    const restored = await body.findByRole('dialog', { name: 'Project restored' })
    await waitFor(() => expect(restored).toBeVisible())
    await waitFor(() => expect(archived).not.toBeInTheDocument())
  },
}

function PromiseExample({ outcome }: { outcome: 'success' | 'error' }) {
  const [manager] = React.useState(createToastManager)
  const toast = createToast(manager)
  const [request, setRequest] = React.useState<{
    resolve: (fileName: string) => void
    reject: (error: Error) => void
  } | null>(null)

  const startExport = () => {
    const promise = new Promise<string>((resolve, reject) => setRequest({ resolve, reject }))
    void toast
      .promise(promise, {
        loading: 'Preparing export',
        success: (fileName) => ({
          title: 'Export complete',
          description: `${fileName} is ready to download.`,
        }),
        error: 'Export failed',
      })
      .catch(() => undefined)
      .finally(() => setRequest(null))
  }

  return (
    <React.Fragment>
      <Toaster toastManager={manager} timeout={0} />
      <Button disabled={request !== null} onClick={startExport}>
        Start export
      </Button>
      <Button
        variant="secondary"
        disabled={request === null}
        onClick={() => {
          if (outcome === 'success') request?.resolve('workflow.yml')
          else request?.reject(new globalThis.Error('Storage unavailable'))
        }}
      >
        {outcome === 'success' ? 'Complete export' : 'Fail export'}
      </Button>
    </React.Fragment>
  )
}

export const PromiseSuccess: Story = {
  parameters: {
    controls: { disable: true },
    docs: {
      description: {
        story:
          'Start an export, then resolve the simulated request. `toast.promise` updates the same card from loading to success. The completion button makes each state available for inspection.',
      },
    },
  },
  render: () => <PromiseExample outcome="success" />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(canvas.getByRole('button', { name: 'Start export' }))
    const notification = await body.findByRole('dialog', { name: 'Preparing export' })
    await expect(notification).toHaveAttribute('data-type', 'loading')
    await userEvent.click(canvas.getByRole('button', { name: 'Complete export' }))
    await expect(await body.findByRole('dialog', { name: 'Export complete' })).toBe(notification)
    await waitFor(() =>
      expect(within(notification).getByText('workflow.yml is ready to download.')).toBeVisible(),
    )
    await expect(canvas.getByRole('button', { name: 'Start export' })).toBeEnabled()
  },
}

export const PromiseError: Story = {
  parameters: {
    controls: { disable: true },
    docs: {
      description: {
        story:
          'Reject the simulated request to inspect loading → error. The rejection is handled after the notification reports the failure.',
      },
    },
  },
  render: () => <PromiseExample outcome="error" />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(canvas.getByRole('button', { name: 'Start export' }))
    const notification = await body.findByRole('dialog', { name: 'Preparing export' })
    await expect(notification).toHaveAttribute('data-type', 'loading')
    await userEvent.click(canvas.getByRole('button', { name: 'Fail export' }))
    await expect(await body.findByRole('dialog', { name: 'Export failed' })).toBe(notification)
    await waitFor(() => expect(notification).toBeVisible())
    await expect(notification).toHaveAttribute('data-type', 'error')
    await expect(canvas.getByRole('button', { name: 'Start export' })).toBeEnabled()
  },
}

function DeduplicatedExample() {
  const [manager] = React.useState(createToastManager)
  const toast = createToast(manager)
  const savesRef = React.useRef(0)

  return (
    <React.Fragment>
      <Toaster toastManager={manager} timeout={0} />
      <Button
        onClick={() => {
          savesRef.current += 1
          toast.success('Draft saved', {
            id: 'draft-save',
            description: `Saved ${savesRef.current} times in this session.`,
          })
        }}
      >
        Save draft
      </Button>
    </React.Fragment>
  )
}

export const Deduplicated: Story = {
  parameters: {
    controls: { disable: true },
    docs: {
      description: {
        story:
          'Repeated calls with the same `id` update the mounted notification instead of adding another card. Dify uses Base UI’s upsert behavior without adding a pulse animation.',
      },
    },
  },
  render: () => <DeduplicatedExample />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    const save = canvas.getByRole('button', { name: 'Save draft' })
    await userEvent.click(save)
    const notification = await body.findByRole('dialog', { name: 'Draft saved' })
    await userEvent.click(save)
    await waitFor(() =>
      expect(within(notification).getByText('Saved 2 times in this session.')).toBeVisible(),
    )
    await expect(body.getAllByRole('dialog')).toEqual([notification])
  },
}

function UpdateExample() {
  const [manager] = React.useState(createToastManager)
  const toast = createToast(manager)
  const [id, setId] = React.useState<string | null>(null)

  return (
    <React.Fragment>
      <Toaster toastManager={manager} timeout={0} />
      <Button
        disabled={id !== null}
        onClick={() => {
          setId(toast.info('Import queued', { onClose: () => setId(null) }))
        }}
      >
        Queue import
      </Button>
      <Button
        variant="secondary"
        disabled={id === null}
        onClick={() => {
          if (id)
            toast.update(id, {
              type: 'success',
              title: 'Import complete',
              description: '128 records imported.',
            })
        }}
      >
        Complete import
      </Button>
      <Button
        variant="secondary"
        disabled={id === null}
        onClick={() => {
          if (id) toast.dismiss(id)
        }}
      >
        Dismiss import
      </Button>
    </React.Fragment>
  )
}

export const ProgrammaticUpdate: Story = {
  parameters: {
    controls: { disable: true },
    docs: {
      description: {
        story:
          'Keep the returned notification ID to update or dismiss it later, without a promise. The close callback resets the controls for another run.',
      },
    },
  },
  render: () => <UpdateExample />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(canvas.getByRole('button', { name: 'Queue import' }))
    const notification = await body.findByRole('dialog', { name: 'Import queued' })
    await userEvent.click(canvas.getByRole('button', { name: 'Complete import' }))
    await expect(await body.findByRole('dialog', { name: 'Import complete' })).toBe(notification)
    await userEvent.click(canvas.getByRole('button', { name: 'Dismiss import' }))
    await waitFor(() => expect(notification).not.toBeInTheDocument())
    await expect(canvas.getByRole('button', { name: 'Queue import' })).toBeEnabled()
  },
}

const longToastTitle =
  'operation error S3: PutObject, exceeded maximum number of attempts, 3, StatusCode: 0, RequestID: , HostID: , request send failed'
const longToastDescription =
  'Put "https://plugin/assets/1bd032bb73218a5d141b80cab7111?x-id=PutObject": dial tcp 192.168.0.200:19000: connect: connection refused, icon small en_US failed to remap assets failed to store plugin asset'

export const LongContent: Story = {
  args: { type: 'error', title: longToastTitle, description: longToastDescription },
  parameters: {
    docs: {
      description: {
        story:
          'Long diagnostic text wraps within the card. Resize the preview to inspect the title, description, and close button at narrow widths.',
      },
    },
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(canvas.getByRole('button', { name: 'Show notification' }))
    const notification = await body.findByRole('dialog', { name: longToastTitle })
    await waitFor(() => expect(notification).toBeVisible())
    const title = within(notification).getByText(longToastTitle)
    const description = within(notification).getByText(longToastDescription)
    await expect(title.scrollWidth).toBeLessThanOrEqual(title.clientWidth)
    await expect(description.scrollWidth).toBeLessThanOrEqual(description.clientWidth)
  },
}
