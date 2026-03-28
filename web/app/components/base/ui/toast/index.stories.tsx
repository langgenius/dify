import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import type { ReactNode } from 'react'
import { toast, ToastHost } from '.'

const buttonClassName = 'rounded-lg border border-divider-subtle bg-components-button-secondary-bg px-3 py-2 text-sm text-text-secondary shadow-xs transition-colors hover:bg-state-base-hover'
const cardClassName = 'flex min-h-[220px] flex-col gap-4 rounded-2xl border border-divider-subtle bg-components-panel-bg p-6 shadow-sm shadow-shadow-shadow-3'

const ExampleCard = ({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string
  title: string
  description: string
  children: ReactNode
}) => {
  return (
    <section className={cardClassName}>
      <div className="space-y-2">
        <div className="text-xs uppercase tracking-[0.18em] text-text-tertiary">
          {eyebrow}
        </div>
        <h3 className="text-base font-semibold leading-6 text-text-primary">
          {title}
        </h3>
        <p className="text-sm leading-6 text-text-secondary">
          {description}
        </p>
      </div>
      <div className="mt-auto flex flex-wrap gap-3">
        {children}
      </div>
    </section>
  )
}

const VariantExamples = () => {
  const createVariantToast = (type: 'success' | 'error' | 'warning' | 'info') => {
    const copy = {
      success: {
        title: 'Changes saved',
        description: 'Your draft is available to collaborators.',
      },
      error: {
        title: 'Sync failed',
        description: 'Check your network connection and try again.',
      },
      warning: {
        title: 'Storage almost full',
        description: 'You have less than 10% of workspace quota remaining.',
      },
      info: {
        title: 'Invitation sent',
        description: 'An email has been sent to the new teammate.',
      },
    } as const

    toast[type](copy[type].title, {
      description: copy[type].description,
    })
  }

  return (
    <ExampleCard
      eyebrow="Variants"
      title="Tone-specific notifications"
      description="Trigger the four supported tones from the shared viewport to validate iconography, gradient treatment, and copy density."
    >
      <button type="button" className={buttonClassName} onClick={() => createVariantToast('success')}>
        Success
      </button>
      <button type="button" className={buttonClassName} onClick={() => createVariantToast('info')}>
        Info
      </button>
      <button type="button" className={buttonClassName} onClick={() => createVariantToast('warning')}>
        Warning
      </button>
      <button type="button" className={buttonClassName} onClick={() => createVariantToast('error')}>
        Error
      </button>
    </ExampleCard>
  )
}

const StackExamples = () => {
  const createStack = () => {
    ;[
      {
        type: 'info' as const,
        title: 'Generating preview',
        description: 'The first toast compresses behind the newest notification.',
      },
      {
        type: 'warning' as const,
        title: 'Review required',
        description: 'A second toast should deepen the stack without breaking spacing.',
      },
      {
        type: 'success' as const,
        title: 'Ready to publish',
        description: 'The newest toast stays frontmost while older items tuck behind it.',
      },
    ].forEach((item) => {
      toast[item.type](item.title, {
        description: item.description,
      })
    })
  }

  const createBurst = () => {
    Array.from({ length: 5 }).forEach((_, index) => {
      toast[index % 2 === 0 ? 'info' : 'success'](`Background task ${index + 1}`, {
        description: 'Use this to inspect how the stack behaves near the host limit.',
      })
    })
  }

  return (
    <ExampleCard
      eyebrow="Stack"
      title="Stacked viewport behavior"
      description="These examples mirror the Base UI docs pattern: repeated triggers should compress into a single shared stack at the top-right corner."
    >
      <button type="button" className={buttonClassName} onClick={createStack}>
        Create 3 stacked toasts
      </button>
      <button type="button" className={buttonClassName} onClick={createBurst}>
        Stress the stack
      </button>
    </ExampleCard>
  )
}

const PromiseExamples = () => {
  const createPromiseToast = () => {
    const request = new Promise<string>((resolve) => {
      window.setTimeout(() => resolve('The deployment is now available in production.'), 1400)
    })

    void toast.promise(request, {
      loading: {
        type: 'info',
        title: 'Deploying workflow',
        description: 'Provisioning runtime and publishing the latest version.',
      },
      success: result => ({
        type: 'success',
        title: 'Deployment complete',
        description: result,
      }),
      error: () => ({
        type: 'error',
        title: 'Deployment failed',
        description: 'The release could not be completed.',
      }),
    })
  }

  const createRejectingPromiseToast = () => {
    const request = new Promise<string>((_, reject) => {
      window.setTimeout(() => reject(new Error('intentional story failure')), 1200)
    })

    void toast.promise(request, {
      loading: 'Validating model credentials…',
      success: 'Credentials verified',
      error: () => ({
        type: 'error',
        title: 'Credentials rejected',
        description: 'The model provider returned an authentication error.',
      }),
    })
  }

  return (
    <ExampleCard
      eyebrow="Promise"
      title="Async lifecycle"
      description="The promise helper should swap the same toast through loading, success, and error states instead of growing the stack unnecessarily."
    >
      <button type="button" className={buttonClassName} onClick={createPromiseToast}>
        Promise success
      </button>
      <button type="button" className={buttonClassName} onClick={createRejectingPromiseToast}>
        Promise error
      </button>
    </ExampleCard>
  )
}

const ActionExamples = () => {
  const createActionToast = () => {
    toast.warning('Project archived', {
      description: 'You can restore it from workspace settings for the next 30 days.',
      actionProps: {
        children: 'Undo',
        onClick: () => {
          toast.success('Project restored', {
            description: 'The workspace is active again.',
          })
        },
      },
    })
  }

  const createLongCopyToast = () => {
    toast.info('Knowledge ingestion in progress', {
      description: 'This longer example helps validate line wrapping, close button alignment, and action button placement when the content spans multiple rows.',
      actionProps: {
        children: 'View details',
        onClick: () => {
          toast.info('Job details opened')
        },
      },
    })
  }

  return (
    <ExampleCard
      eyebrow="Action"
      title="Actionable toasts"
      description="Use these to verify the secondary action button, multi-line content, and the close affordance under tighter layouts."
    >
      <button type="button" className={buttonClassName} onClick={createActionToast}>
        Undo action
      </button>
      <button type="button" className={buttonClassName} onClick={createLongCopyToast}>
        Long content
      </button>
    </ExampleCard>
  )
}

const UpdateExamples = () => {
  const createUpdatableToast = () => {
    const toastId = toast.info('Import started', {
      description: 'Preparing assets and metadata for processing.',
      timeout: 0,
    })

    window.setTimeout(() => {
      toast.update(toastId, {
        type: 'success',
        title: 'Import finished',
        description: '128 records were imported successfully.',
        timeout: 5000,
      })
    }, 1400)
  }

  const clearAll = () => {
    toast.dismiss()
  }

  return (
    <ExampleCard
      eyebrow="Update"
      title="Programmatic lifecycle"
      description="This example exercises manual updates on an existing toast and keeps a clear-all control nearby for repeated interaction during review."
    >
      <button type="button" className={buttonClassName} onClick={createUpdatableToast}>
        Add then update
      </button>
      <button type="button" className={buttonClassName} onClick={clearAll}>
        Clear all
      </button>
    </ExampleCard>
  )
}

const ToastDocsDemo = () => {
  return (
    <>
      <ToastHost timeout={5000} limit={5} />
      <div className="min-h-screen bg-background-default-subtle px-6 py-12">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
          <div className="space-y-3">
            <div className="text-xs uppercase tracking-[0.18em] text-text-tertiary">
              Base UI toast docs
            </div>
            <h2 className="text-[24px] font-semibold leading-8 text-text-primary">
              Shared stacked toast examples
            </h2>
            <p className="max-w-3xl text-sm leading-6 text-text-secondary">
              Each example card below triggers the same shared toast viewport in the top-right corner, so you can review stacking, state transitions, actions, and tone variants the same way the official Base UI documentation demonstrates toast behavior.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <VariantExamples />
            <StackExamples />
            <PromiseExamples />
            <ActionExamples />
            <UpdateExamples />
          </div>
        </div>
      </div>
    </>
  )
}

const meta = {
  title: 'Base/Feedback/UI Toast',
  component: ToastHost,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Dify toast host built on Base UI Toast. The story is organized as multiple example panels that all feed the same shared toast viewport, matching the way the Base UI documentation showcases toast behavior.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof ToastHost>

export default meta
type Story = StoryObj<typeof meta>

export const DocsPattern: Story = {
  render: () => <ToastDocsDemo />,
}
