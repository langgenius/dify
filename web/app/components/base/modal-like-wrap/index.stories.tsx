import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import ModalLikeWrap from '.'

const meta = {
  title: 'Base/Feedback/ModalLikeWrap',
  component: ModalLikeWrap,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Compact “modal-like” card used in wizards. Provides header actions, optional back slot, and confirm/cancel buttons.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    title: {
      control: 'text',
      description: 'Header title text.',
    },
    className: {
      control: 'text',
      description: 'Additional classes on the wrapper.',
    },
    beforeHeader: {
      control: false,
      description: 'Slot rendered before the header (commonly a back link).',
    },
    hideCloseBtn: {
      control: 'boolean',
      description: 'Hides the top-right close icon when true.',
    },
    children: {
      control: false,
    },
    onClose: {
      control: false,
    },
    onConfirm: {
      control: false,
    },
  },
  args: {
    title: 'Create dataset field',
    hideCloseBtn: false,
    onClose: () => console.log('close'),
    onConfirm: () => console.log('confirm'),
    children: null,
  },
} satisfies Meta<typeof ModalLikeWrap>

export default meta
type Story = StoryObj<typeof meta>

const BaseContent = () => (
  <div className="space-y-3 text-sm text-gray-600">
    <p>
      Describe the new field your dataset should collect. Provide a clear label and optional helper text.
    </p>
    <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-4 text-xs text-gray-500">
      Form inputs would be placed here in the real flow.
    </div>
  </div>
)

export const Default: Story = {
  render: args => (
    <ModalLikeWrap {...args}>
      <BaseContent />
    </ModalLikeWrap>
  ),
  args: {
    children: null,
  },
}

export const WithBackLink: Story = {
  render: args => (
    <ModalLikeWrap
      {...args}
      hideCloseBtn
      beforeHeader={(
        <button
          className="mb-1 flex items-center gap-1 text-xs font-medium uppercase text-text-accent"
          onClick={() => console.log('back')}
        >
          <span className="bg-text-accent/10 inline-block h-4 w-4 rounded text-center text-[10px] leading-4 text-text-accent">{'<'}</span>
          Back
        </button>
      )}
    >
      <BaseContent />
    </ModalLikeWrap>
  ),
  args: {
    title: 'Select metadata type',
    children: null,
  },
  parameters: {
    docs: {
      description: {
        story: 'Demonstrates feeding content into `beforeHeader` while hiding the close button.',
      },
    },
  },
}

export const CustomWidth: Story = {
  render: args => (
    <ModalLikeWrap
      {...args}
      className="w-[420px]"
    >
      <BaseContent />
      <div className="mt-4 rounded-md bg-blue-50 p-3 text-xs text-blue-600">
        Tip: metadata keys may only include letters, numbers, and underscores.
      </div>
    </ModalLikeWrap>
  ),
  args: {
    title: 'Advanced configuration',
    children: null,
  },
  parameters: {
    docs: {
      description: {
        story: 'Applies extra width and helper messaging to emulate configuration panels.',
      },
    },
  },
}
