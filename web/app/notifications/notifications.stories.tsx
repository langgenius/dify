import type { ToastApi, ToastManager, ToastViewportProps } from '@langgenius/dify-ui/toast'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import {
  createToast,
  createToastManager,
  ToastCard,
  ToastPortal,
  ToastProvider,
  ToastViewport,
  useToastManager,
} from '@langgenius/dify-ui/toast'
import { useState } from 'react'
import { expect, spyOn, userEvent, within } from 'storybook/test'
import { toast as globalToast } from '.'
import { AppToastHost } from './host'

function ToastCards() {
  const { toasts } = useToastManager<Record<string, never>>()
  return toasts.map((item) => <ToastCard key={item.id} toast={item} />)
}

function ExampleToastHost({
  manager,
  timeout,
  limit,
  offset,
}: {
  manager: ToastManager
  timeout?: number
  limit?: number
  offset?: ToastViewportProps['offset']
}) {
  return (
    <ToastProvider toastManager={manager} timeout={timeout} limit={limit}>
      <ToastPortal>
        <ToastViewport offset={offset}>
          <ToastCards />
        </ToastViewport>
      </ToastPortal>
    </ToastProvider>
  )
}

type Scenario = { label: string; run: (toast: ToastApi) => void }
type PlaygroundProps = {
  description: string
  scenarios: Scenario[]
  primitive?: boolean
  timeout?: number
  limit?: number
}

const diagnostic =
  'Failed to install plugin langgenius/openai:0.2.7: failed to remap assets and persist provider icon because the object storage service rejected the upload after all retry attempts.'
const details = [
  'operation error S3: PutObject, exceeded maximum number of attempts, 3, StatusCode: 0, RequestID: req-78bb251e-ec45-4974-b8a8-2c70bd8b9e12, HostID: storage-internal-03.',
  'PUT "https://storage.example.com/plugin-assets/1bd032bb73218a5d141b80cab7111/providers/openai/icon-large-en_US.svg?x-id=PutObject": dial tcp 192.168.0.200:19000: connect: connection refused.',
  'Unable to store asset icon_large_en_US. The plugin package was downloaded and validated, but installation could not complete because the configured S3 endpoint is unreachable from the plugin daemon.',
  'Check the storage endpoint, bucket permissions, service credentials, and network routing before retrying. This diagnostic intentionally includes enough detail to reproduce the original installation failure.',
].join('\n')
const buttonClassName =
  'rounded-lg border border-divider-regular bg-components-button-secondary-bg px-3 py-2 text-sm text-text-primary hover:bg-state-base-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-state-accent-solid'

function Playground({
  description,
  scenarios,
  primitive = false,
  timeout = 0,
  limit = 3,
}: PlaygroundProps) {
  const [{ manager, toast }] = useState(() => {
    const manager = createToastManager()
    return { manager, toast: createToast(manager) }
  })
  return (
    <main className="min-h-screen space-y-5 bg-background-body p-6">
      <p className="max-w-2xl text-sm text-text-secondary">{description}</p>
      <p className="max-w-2xl text-xs text-text-tertiary">
        F6 enters notifications. Tab reaches the card, action, and close button. Use Enter or Space
        to activate. Clear notifications between cases. Switch the theme or resize the preview to
        inspect layout.
      </p>
      <div className="flex max-w-2xl flex-wrap gap-3">
        {scenarios.map(({ label, run }) => (
          <button key={label} type="button" className={buttonClassName} onClick={() => run(toast)}>
            {label}
          </button>
        ))}
        <button type="button" className={buttonClassName} onClick={() => toast.dismiss()}>
          Clear notifications
        </button>
      </div>
      <label className="flex max-w-2xl flex-col gap-2 text-sm text-text-primary">
        Focus return target
        <input
          className="rounded-lg border border-divider-regular bg-components-panel-bg p-2"
          placeholder="Keep typing after dismissal"
        />
      </label>
      {primitive ? (
        <ExampleToastHost manager={manager} timeout={timeout} limit={limit} />
      ) : (
        <AppToastHost manager={manager} timeout={timeout} limit={limit} />
      )}
    </main>
  )
}

const meta = {
  title: 'Application/Notifications',
  component: Playground,
  parameters: { layout: 'fullscreen' },
  argTypes: { scenarios: { control: false, table: { disable: true } } },
  args: { description: '', scenarios: [] },
  tags: ['!autodocs'],
} satisfies Meta<typeof Playground>
export default meta
type Story = StoryObj<typeof meta>

export const Tones: Story = {
  args: {
    description:
      'Only error notifications gain an automatic copy action. Plain, success, warning, and info retain the primitive appearance.',
    scenarios: [
      { label: 'Plain', run: (toast) => toast('New activity') },
      {
        label: 'Success',
        run: (toast) => toast.success('Saved', { description: 'Your changes are available.' }),
      },
      { label: 'Warning', run: (toast) => toast.warning('Storage almost full') },
      { label: 'Info', run: (toast) => toast.info('Invitation sent') },
      { label: 'Error', run: (toast) => toast.error('Upload failed', { description: details }) },
      {
        label: 'Error via callable API',
        run: (toast) => toast('Connection failed', { type: 'error' }),
      },
    ],
  },
}

export const PrimitiveParity: Story = {
  args: {
    primitive: true,
    description:
      'Direct Dify UI factory: an error still has only its close control. Actions remain caller-owned and do not dismiss automatically.',
    scenarios: [
      {
        label: 'Primitive error',
        run: (toast) => toast.error(diagnostic, { description: details }),
      },
      {
        label: 'Primitive action',
        run: (toast) =>
          toast.info('Review available', {
            actionProps: { children: 'Review', onClick: () => toast.success('Review opened') },
          }),
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Primitive error$/ }))
    const body = within(canvasElement.ownerDocument.body)
    await expect(await body.findByRole('dialog', { name: diagnostic })).toBeVisible()
    await expect(body.queryByRole('button', { name: 'Copy error details' })).not.toBeInTheDocument()
  },
}

export const ErrorContent: Story = {
  args: {
    description:
      'Copy preserves the full plain-text title and description, separated by a newline. Empty content and React nodes do not generate a misleading copy action.',
    scenarios: [
      { label: 'Title only', run: (toast) => toast.error('Connection failed') },
      { label: 'Description only', run: (toast) => toast.error(null, { description: details }) },
      {
        label: 'Empty title',
        run: (toast) => toast.error('', { description: 'Useful error detail' }),
      },
      { label: 'Empty content', run: (toast) => toast.error('') },
      {
        label: 'Unicode and multiline',
        run: (toast) =>
          toast.error('上传失败 / فشل التحميل / 🚫', {
            description: '第一行\nSecond line\n<not html> & "quoted"',
          }),
      },
      {
        label: 'Rich title',
        run: (toast) =>
          toast.error(<strong>Permission denied</strong>, {
            description: 'Ask your workspace administrator.',
          }),
      },
      {
        label: 'Rich description',
        run: (toast) =>
          toast.error('Access denied', {
            description: <a href="#permission-help">View permission help</a>,
          }),
      },
      { label: 'Numeric content', run: (toast) => toast.error(503) },
    ],
  },
}

export const LongContent: Story = {
  args: {
    description:
      'Inspect long diagnostics, unbroken tokens, and many lines at narrow widths and both themes. There is intentionally no new maximum-height policy; very long cards expose the existing primitive layout limit.',
    scenarios: [
      {
        label: 'Realistic diagnostic',
        run: (toast) => toast.error(diagnostic, { description: details }),
      },
      {
        label: 'Unbroken token',
        run: (toast) =>
          toast.error('Invalid response', { description: '0123456789abcdef'.repeat(30) }),
      },
      { label: 'Very long title', run: (toast) => toast.error(diagnostic.repeat(8)) },
      {
        label: 'Many lines',
        run: (toast) =>
          toast.error('Validation errors', {
            description: Array.from(
              { length: 30 },
              (_, i) => `Field ${i + 1}: required value is missing`,
            ).join('\n'),
          }),
      },
    ],
  },
}

export const CallerActions: Story = {
  args: {
    description:
      'Caller actions remain available alongside copying for text errors, including repeated IDs and updates. Rich content retains its caller action without extracting text.',
    scenarios: [
      {
        label: 'Custom retry',
        run: (toast) =>
          toast.error('Retryable failure', {
            id: 'custom',
            actionProps: {
              children: 'Retry request',
              onClick: () =>
                toast.update('custom', {
                  title: 'Recovered',
                  type: 'success',
                  actionProps: undefined,
                }),
            },
          }),
      },
      {
        label: 'Update custom title',
        run: (toast) => toast.error('Still unavailable', { id: 'custom' }),
      },
      {
        label: 'Remove custom action',
        run: (toast) => toast.update('custom', { actionProps: undefined }),
      },
      {
        label: 'Rich error with explicit action',
        run: (toast) =>
          toast.error(<strong>Session expired</strong>, {
            actionProps: {
              children: 'Sign in again',
              onClick: () => toast.success('Sign-in action invoked'),
            },
          }),
      },
    ],
  },
}

export const UpdatesAndRepeatedIds: Story = {
  args: {
    description:
      'Run these controls in sequence. A repeated ID remains one card and retains omitted description fields. Copy must follow the effective content; success removes the generated action.',
    scenarios: [
      {
        label: '1. Create error',
        run: (toast) =>
          toast.error('Original title', { id: 'upsert', description: 'Retained description' }),
      },
      {
        label: '2. Replace title via same ID',
        run: (toast) => toast.error('Updated title', { id: 'upsert' }),
      },
      {
        label: '3. Replace description',
        run: (toast) => toast.update('upsert', { description: 'New description' }),
      },
      {
        label: '4. Clear description',
        run: (toast) => toast.update('upsert', { description: null }),
      },
      {
        label: '5. Recover',
        run: (toast) => toast.update('upsert', { title: 'Recovered', type: 'success' }),
      },
      {
        label: '6. Fail again',
        run: (toast) => toast.update('upsert', { title: 'Failed again', type: 'error' }),
      },
      { label: 'Dismiss one', run: (toast) => toast.dismiss('upsert') },
      {
        label: 'Update absent ID',
        run: (toast) =>
          toast.update('does-not-exist', { title: 'Should not appear', type: 'error' }),
      },
    ],
  },
}

export const PromiseResults: Story = {
  args: {
    description:
      'A loading toast transitions in place. Error callbacks and string errors get copy actions; caller actions and inherited loading descriptions remain intact. Rejections are handled by these demo triggers.',
    scenarios: [
      {
        label: 'Resolve',
        run: (toast) => {
          void toast.promise(
            new Promise<string>((resolve) => setTimeout(() => resolve('Upload'), 1200)),
            {
              loading: 'Uploading…',
              success: (value) => `${value} complete`,
              error: 'Upload failed',
            },
          )
        },
      },
      {
        label: 'Reject string',
        run: (toast) => {
          void toast
            .promise(
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Network failed')), 1200),
              ),
              { loading: 'Connecting…', success: 'Connected', error: 'Connection failed' },
            )
            .catch(() => {})
        },
      },
      {
        label: 'Reject with details',
        run: (toast) => {
          void toast
            .promise(Promise.reject(new Error('Connection refused')), {
              loading: 'Uploading…',
              success: 'Uploaded',
              error: (error) => ({ title: 'Upload failed', description: String(error) }),
            })
            .catch(() => {})
        },
      },
      {
        label: 'Retain loading description',
        run: (toast) => {
          void toast
            .promise(Promise.reject(new Error('Denied')), {
              loading: { title: 'Uploading…', description: 'File: document.pdf' },
              success: 'Uploaded',
              error: 'Permission denied',
            })
            .catch(() => {})
        },
      },
      {
        label: 'Explicit promise action',
        run: (toast) => {
          void toast
            .promise(Promise.reject(new Error('Denied')), {
              loading: 'Checking…',
              success: 'Ready',
              error: {
                title: 'Access denied',
                actionProps: {
                  children: 'Request access',
                  onClick: () => toast.info('Access requested'),
                },
              },
            })
            .catch(() => {})
        },
      },
    ],
  },
}

export const StackAndDismissal: Story = {
  args: {
    description:
      'Limit three visible cards. Hover or focus expands the stack. Close individual cards, dismiss all, or swipe upward/right; a downward gesture should not dismiss this top-anchored stack.',
    scenarios: [
      {
        label: 'Burst of six',
        run: (toast) => {
          for (let i = 1; i <= 6; i++)
            toast.error(`Failure ${i}`, { description: `Diagnostic ${i}` })
        },
      },
      {
        label: 'Mixed stack',
        run: (toast) => {
          toast.success('Saved')
          toast.warning('Quota low')
          toast.error('Sync failed', { description: details })
        },
      },
      {
        label: 'Persistent error',
        run: (toast) => toast.error('Still needs attention', { timeout: 0 }),
      },
    ],
  },
}

export const AutoDismissAndPause: Story = {
  args: {
    timeout: 3000,
    description:
      'Default timeout is three seconds in this story. Hovering or keyboard focus pauses dismissal. Copy feedback must not extend the timeout or dismiss the card. Persistent errors remain until closed.',
    scenarios: [
      { label: 'Timed error', run: (toast) => toast.error('Expires after three seconds') },
      {
        label: 'Persistent error',
        run: (toast) => toast.error('Persistent error', { timeout: 0 }),
      },
      { label: 'Short success', run: (toast) => toast.success('Saved briefly', { timeout: 1000 }) },
    ],
  },
}

export const CopyFeedback: Story = {
  args: {
    description:
      'Real clipboard integration: copy, paste into the field, and compare all lines. The action shows Copied for two seconds and remains focused. Repeated copying stays within the same toast.',
    scenarios: [
      {
        label: 'Show copyable error',
        run: (toast) => toast.error(diagnostic, { description: details }),
      },
    ],
  },
}

export const ClipboardFailure: Story = {
  ...CopyFeedback,
  args: {
    ...CopyFeedback.args,
    description:
      'Simulated clipboard and fallback rejection. Copy reports failure in the same action; retry remains available and no secondary error toast appears.',
  },
  beforeEach: () => {
    const clipboard = spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
      new Error('Permission denied'),
    )
    const fallback = spyOn(document, 'execCommand').mockReturnValue(false)
    return () => {
      clipboard.mockRestore()
      fallback.mockRestore()
    }
  },
}

export const ClipboardFallback: Story = {
  ...CopyFeedback,
  args: {
    ...CopyFeedback.args,
    description:
      'Simulated Clipboard API rejection. The real foxact selection-based fallback runs with execCommand success simulated. Check that the copy button retains keyboard focus.',
  },
  beforeEach: () => {
    const clipboard = spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
      new Error('Permission denied'),
    )
    const fallback = spyOn(document, 'execCommand').mockReturnValue(true)
    return () => {
      clipboard.mockRestore()
      fallback.mockRestore()
    }
  },
}

export const PendingCopyAndReplacement: Story = {
  args: {
    description:
      'Clipboard completion is delayed two seconds. Click copy repeatedly, then replace or dismiss the card while pending. The new card must not show stale Copied feedback.',
    scenarios: [
      {
        label: 'Original error',
        run: (toast) => toast.error('Original diagnostic', { id: 'pending' }),
      },
      {
        label: 'Replace while copying',
        run: (toast) => toast.error('Replacement diagnostic', { id: 'pending' }),
      },
      { label: 'Dismiss while copying', run: (toast) => toast.dismiss('pending') },
    ],
  },
  beforeEach: () => {
    const clipboard = spyOn(navigator.clipboard, 'writeText').mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 2000)),
    )
    return () => clipboard.mockRestore()
  },
}

function IsolatedHosts() {
  const [{ left, right }] = useState(() => {
    const make = () => {
      const manager = createToastManager()
      return { manager, toast: createToast(manager) }
    }
    return { left: make(), right: make() }
  })
  return (
    <main className="min-h-screen space-y-4 bg-background-body p-6">
      <p className="max-w-2xl text-sm text-text-secondary">
        Two independently owned managers reuse the same ID. Updating or dismissing one must leave
        the other intact. The second viewport uses the configuration host's 60px top offset.
      </p>
      <div className="flex max-w-2xl flex-wrap gap-3">
        <button
          type="button"
          className={buttonClassName}
          onClick={() => {
            left.toast.error('Left error', { id: 'shared' })
            right.toast.error('Right error', { id: 'shared' })
          }}
        >
          Show both
        </button>
        <button
          type="button"
          className={buttonClassName}
          onClick={() => left.toast.update('shared', { title: 'Left updated' })}
        >
          Update left
        </button>
        <button type="button" className={buttonClassName} onClick={() => left.toast.dismiss()}>
          Dismiss left
        </button>
        <button type="button" className={buttonClassName} onClick={() => right.toast.dismiss()}>
          Dismiss right
        </button>
      </div>
      <AppToastHost manager={left.manager} timeout={0} offset={{ top: 180, right: '52%' }} />
      <AppToastHost manager={right.manager} timeout={0} offset={{ top: 60 }} />
    </main>
  )
}
export const ScopedHostIsolation: Story = { render: () => <IsolatedHosts /> }

export const GlobalWebInstance: Story = {
  args: {
    description:
      'Uses the actual web singleton and the AppToastHost already mounted by the Storybook decorator. Copy, typed calls, and dismissals use the same entrypoint as application callers.',
    scenarios: [
      {
        label: 'Global error',
        run: () => globalToast.error('Global request failed', { description: details, timeout: 0 }),
      },
      { label: 'Global success', run: () => globalToast.success('Global save complete') },
      { label: 'Dismiss global notifications', run: () => globalToast.dismiss() },
    ],
  },
  beforeEach: () => {
    globalToast.dismiss()
    return () => globalToast.dismiss()
  },
}

export const DarkTheme: Story = {
  ...CopyFeedback,
  globals: { theme: 'dark' },
}

export const NarrowViewport: Story = {
  ...LongContent,
  globals: { viewport: { value: 'toastMobile', isRotated: false } },
  parameters: {
    viewport: {
      options: {
        toastMobile: {
          name: 'Mobile 360px',
          styles: { width: '360px', height: '740px' },
          type: 'mobile',
        },
      },
    },
  },
}
