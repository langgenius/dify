import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useCallback } from 'react'
import Toast, { ToastProvider, useToastContext } from '.'

const ToastControls = () => {
  const { notify } = useToastContext()

  const trigger = useCallback((type: 'success' | 'error' | 'warning' | 'info') => {
    notify({
      type,
      message: `This is a ${type} toast`,
      children: type === 'info' ? 'Additional details can live here.' : undefined,
    })
  }, [notify])

  return (
    <div className="flex flex-wrap gap-3">
      <button
        type="button"
        className="rounded-md border border-divider-subtle bg-background-default px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-state-base-hover"
        onClick={() => trigger('success')}
      >
        Success
      </button>
      <button
        type="button"
        className="rounded-md border border-divider-subtle bg-background-default px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-state-base-hover"
        onClick={() => trigger('info')}
      >
        Info
      </button>
      <button
        type="button"
        className="rounded-md border border-divider-subtle bg-background-default px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-state-base-hover"
        onClick={() => trigger('warning')}
      >
        Warning
      </button>
      <button
        type="button"
        className="rounded-md border border-divider-subtle bg-background-default px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-state-base-hover"
        onClick={() => trigger('error')}
      >
        Error
      </button>
    </div>
  )
}

const ToastProviderDemo = () => {
  return (
    <ToastProvider>
      <div className="flex w-full max-w-md flex-col gap-4 rounded-2xl border border-divider-subtle bg-components-panel-bg p-6">
        <div className="text-xs uppercase tracking-[0.18em] text-text-tertiary">Toast provider</div>
        <ToastControls />
      </div>
    </ToastProvider>
  )
}

const StaticToastDemo = () => {
  return (
    <div className="flex w-full max-w-md flex-col gap-4 rounded-2xl border border-divider-subtle bg-components-panel-bg p-6">
      <div className="text-xs uppercase tracking-[0.18em] text-text-tertiary">Static API</div>
      <button
        type="button"
        className="self-start rounded-md border border-divider-subtle bg-background-default px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-state-base-hover"
        onClick={() => {
          const handle = Toast.notify({
            type: 'success',
            message: 'Saved changes',
            duration: 2000,
          })
          setTimeout(() => handle.clear?.(), 2500)
        }}
      >
        Trigger Toast.notify()
      </button>
    </div>
  )
}

const meta = {
  title: 'Base/Feedback/Toast',
  component: ToastProviderDemo,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'ToastProvider based notifications and the static Toast.notify helper. Buttons showcase each toast variant.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof ToastProviderDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Provider: Story = {}

export const StaticApi: Story = {
  render: () => <StaticToastDemo />,
}
