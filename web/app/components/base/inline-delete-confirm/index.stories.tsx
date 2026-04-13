import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import { fn } from 'storybook/test'
import InlineDeleteConfirm from '.'

const meta = {
  title: 'Base/Feedback/InlineDeleteConfirm',
  component: InlineDeleteConfirm,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Compact confirmation prompt that appears inline, commonly used near delete buttons or destructive controls.',
      },
    },
  },
  argTypes: {
    variant: {
      control: 'select',
      options: ['delete', 'warning', 'info'],
    },
  },
  args: {
    title: 'Delete this item?',
    confirmText: 'Delete',
    cancelText: 'Cancel',
    onConfirm: fn(),
    onCancel: fn(),
  },
  tags: ['autodocs'],
} satisfies Meta<typeof InlineDeleteConfirm>

export default meta
type Story = StoryObj<typeof meta>

const InlineDeleteConfirmDemo = (args: Story['args']) => {
  const [visible, setVisible] = useState(true)

  return (
    <div className="flex flex-col items-start gap-3">
      <button
        type="button"
        className="rounded-md border border-divider-subtle px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-state-base-hover"
        onClick={() => setVisible(true)}
      >
        Trigger inline confirm
      </button>
      {visible && (
        <InlineDeleteConfirm
          {...args}
          onConfirm={() => {
            console.log('✅ Confirm clicked')
            setVisible(false)
          }}
          onCancel={() => {
            console.log('❎ Cancel clicked')
            setVisible(false)
          }}
        />
      )}
    </div>
  )
}

export const Playground: Story = {
  render: args => <InlineDeleteConfirmDemo {...args} />,
}

export const WarningVariant: Story = {
  render: args => <InlineDeleteConfirmDemo {...args} />,
  args: {
    variant: 'warning',
    title: 'Archive conversation?',
    confirmText: 'Archive',
    cancelText: 'Keep',
  },
}

export const InfoVariant: Story = {
  render: args => <InlineDeleteConfirmDemo {...args} />,
  args: {
    variant: 'info',
    title: 'Remove collaborator?',
    confirmText: 'Remove',
    cancelText: 'Keep',
  },
}
