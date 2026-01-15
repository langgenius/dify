import type { Meta, StoryObj } from '@storybook/nextjs'
import { useEffect, useState } from 'react'
import Modal from '.'

const meta = {
  title: 'Base/Feedback/Modal',
  component: Modal,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Lightweight modal wrapper with optional header/description, close icon, and high-priority stacking for dropdown overlays.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    className: {
      control: 'text',
      description: 'Extra classes applied to the modal panel.',
    },
    wrapperClassName: {
      control: 'text',
      description: 'Additional wrapper classes for the dialog.',
    },
    isShow: {
      control: 'boolean',
      description: 'Controls whether the modal is visible.',
    },
    title: {
      control: 'text',
      description: 'Heading displayed at the top of the modal.',
    },
    description: {
      control: 'text',
      description: 'Secondary text beneath the title.',
    },
    closable: {
      control: 'boolean',
      description: 'Whether the close icon should be shown.',
    },
    overflowVisible: {
      control: 'boolean',
      description: 'Allows content to overflow the modal panel.',
    },
    highPriority: {
      control: 'boolean',
      description: 'Lifts the modal above other high z-index elements like dropdowns.',
    },
    onClose: {
      control: false,
      description: 'Callback invoked when the modal requests to close.',
    },
  },
  args: {
    isShow: false,
    title: 'Create new API key',
    description: 'Generate a scoped key for this workspace. You can revoke it at any time.',
    closable: true,
  },
} satisfies Meta<typeof Modal>

export default meta
type Story = StoryObj<typeof meta>

const ModalDemo = (props: React.ComponentProps<typeof Modal>) => {
  const [open, setOpen] = useState(props.isShow)

  useEffect(() => {
    setOpen(props.isShow)
  }, [props.isShow])

  return (
    <div className="relative flex h-[480px] items-center justify-center bg-gray-100">
      <button
        className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700"
        onClick={() => setOpen(true)}
      >
        Show modal
      </button>

      <Modal
        {...props}
        isShow={open}
        onClose={() => {
          props.onClose?.()
          setOpen(false)
        }}
      >
        <div className="mt-6 space-y-4 text-sm text-gray-600">
          <p>
            Provide a descriptive name for this key so collaborators know its purpose. Restrict usage with scopes to limit access.
          </p>
          <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-4 text-xs text-gray-500">
            Form fields and validation messaging would appear here. This placeholder keeps the story lightweight.
          </div>
        </div>
        <div className="mt-8 flex justify-end gap-3">
          <button
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            onClick={() => setOpen(false)}
          >
            Cancel
          </button>
          <button className="rounded-md bg-primary-600 px-3 py-1.5 text-sm text-white hover:bg-primary-700">
            Create key
          </button>
        </div>
      </Modal>
    </div>
  )
}

export const Default: Story = {
  render: args => <ModalDemo {...args} />,
}

export const HighPriorityOverflow: Story = {
  render: args => <ModalDemo {...args} />,
  args: {
    highPriority: true,
    overflowVisible: true,
    description: 'Demonstrates the modal configured to sit above dropdowns while letting the body content overflow.',
    className: 'max-w-[540px]',
  },
  parameters: {
    docs: {
      description: {
        story: 'Shows the modal with `highPriority` and `overflowVisible` enabled, useful when nested within complex surfaces.',
      },
    },
  },
}
