import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useEffect, useState } from 'react'
import Dialog from '.'

const meta = {
  title: 'Base/Feedback/Dialog',
  component: Dialog,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Modal dialog built on Headless UI. Provides animated overlay, title slot, and optional footer region.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    className: {
      control: 'text',
      description: 'Additional classes applied to the panel.',
    },
    titleClassName: {
      control: 'text',
      description: 'Extra classes for the title element.',
    },
    bodyClassName: {
      control: 'text',
      description: 'Extra classes for the content area.',
    },
    footerClassName: {
      control: 'text',
      description: 'Extra classes for the footer container.',
    },
    title: {
      control: 'text',
      description: 'Dialog title.',
    },
    show: {
      control: 'boolean',
      description: 'Controls visibility of the dialog.',
    },
    onClose: {
      control: false,
      description: 'Called when the dialog backdrop or close handler fires.',
    },
  },
  args: {
    title: 'Manage API Keys',
    show: false,
    children: null,
  },
} satisfies Meta<typeof Dialog>

export default meta
type Story = StoryObj<typeof meta>

const DialogDemo = (props: React.ComponentProps<typeof Dialog>) => {
  const [open, setOpen] = useState(props.show)
  useEffect(() => {
    setOpen(props.show)
  }, [props.show])

  return (
    <div className="relative flex h-[480px] items-center justify-center bg-gray-100">
      <button
        className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700"
        onClick={() => setOpen(true)}
      >
        Show dialog
      </button>

      <Dialog
        {...props}
        show={open}
        onClose={() => {
          props.onClose?.()
          setOpen(false)
        }}
      >
        <div className="space-y-4 text-sm text-gray-600">
          <p>
            Centralize API key management for collaborators. You can revoke, rotate, or generate new keys directly from this dialog.
          </p>
          <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-4 text-xs text-gray-500">
            This placeholder area represents a form or table that would live inside the dialog body.
          </div>
        </div>
      </Dialog>
    </div>
  )
}

export const Default: Story = {
  render: args => <DialogDemo {...args} />,
  args: {
    footer: (
      <>
        <button className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
          Cancel
        </button>
        <button className="rounded-md bg-primary-600 px-3 py-1.5 text-sm text-white hover:bg-primary-700">
          Save changes
        </button>
      </>
    ),
  },
}

export const WithoutFooter: Story = {
  render: args => <DialogDemo {...args} />,
  args: {
    footer: undefined,
    title: 'Read-only summary',
  },
  parameters: {
    docs: {
      description: {
        story: 'Demonstrates the dialog when no footer actions are provided.',
      },
    },
  },
}

export const CustomStyling: Story = {
  render: args => <DialogDemo {...args} />,
  args: {
    className: 'max-w-[560px] bg-white/95 backdrop-blur',
    bodyClassName: 'bg-gray-50 rounded-xl p-5',
    footerClassName: 'justify-between px-4 pb-4 pt-4',
    titleClassName: 'text-lg text-primary-600',
    footer: (
      <>
        <span className="text-xs text-gray-400">Last synced 2 minutes ago</span>
        <div className="flex gap-2">
          <button className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
            Close
          </button>
          <button className="rounded-md bg-primary-600 px-3 py-1.5 text-sm text-white hover:bg-primary-700">
            Refresh data
          </button>
        </div>
      </>
    ),
  },
  parameters: {
    docs: {
      description: {
        story: 'Applies custom classes to the panel, body, title, and footer to match different surfaces.',
      },
    },
  },
}
