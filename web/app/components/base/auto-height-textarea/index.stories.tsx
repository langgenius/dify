import type { Meta, StoryObj } from '@storybook/nextjs'
import { useState } from 'react'
import AutoHeightTextarea from '.'

const meta = {
  title: 'Base/Data Entry/AutoHeightTextarea',
  component: AutoHeightTextarea,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Auto-resizing textarea component that expands and contracts based on content, with configurable min/max height constraints.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    placeholder: {
      control: 'text',
      description: 'Placeholder text',
    },
    value: {
      control: 'text',
      description: 'Textarea value',
    },
    onChange: {
      action: 'changed',
      description: 'Change handler',
    },
    minHeight: {
      control: 'number',
      description: 'Minimum height in pixels',
    },
    maxHeight: {
      control: 'number',
      description: 'Maximum height in pixels',
    },
    autoFocus: {
      control: 'boolean',
      description: 'Auto focus on mount',
    },
    className: {
      control: 'text',
      description: 'Additional CSS classes',
    },
    wrapperClassName: {
      control: 'text',
      description: 'Wrapper CSS classes',
    },
  },
  args: {
    onChange: (e) => {
      console.log('Text changed:', e.target.value)
    },
  },
} satisfies Meta<typeof AutoHeightTextarea>

export default meta
type Story = StoryObj<typeof meta>

// Interactive demo wrapper
const AutoHeightTextareaDemo = (args: any) => {
  const [value, setValue] = useState(args.value || '')

  return (
    <div style={{ width: '500px' }}>
      <AutoHeightTextarea
        {...args}
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          console.log('Text changed:', e.target.value)
        }}
      />
    </div>
  )
}

// Default state
export const Default: Story = {
  render: args => <AutoHeightTextareaDemo {...args} />,
  args: {
    placeholder: 'Type something...',
    value: '',
    minHeight: 36,
    maxHeight: 96,
    className: 'w-full p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500',
  },
}

// With initial value
export const WithInitialValue: Story = {
  render: args => <AutoHeightTextareaDemo {...args} />,
  args: {
    placeholder: 'Type something...',
    value: 'This is a pre-filled textarea with some initial content.',
    minHeight: 36,
    maxHeight: 96,
    className: 'w-full p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500',
  },
}

// With multiline content
export const MultilineContent: Story = {
  render: args => <AutoHeightTextareaDemo {...args} />,
  args: {
    placeholder: 'Type something...',
    value: 'Line 1\nLine 2\nLine 3\nLine 4\nThis textarea automatically expands to fit the content.',
    minHeight: 36,
    maxHeight: 96,
    className: 'w-full p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500',
  },
}

// Custom min height
export const CustomMinHeight: Story = {
  render: args => <AutoHeightTextareaDemo {...args} />,
  args: {
    placeholder: 'Taller minimum height...',
    value: '',
    minHeight: 100,
    maxHeight: 200,
    className: 'w-full p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500',
  },
}

// Small max height (scrollable)
export const SmallMaxHeight: Story = {
  render: args => <AutoHeightTextareaDemo {...args} />,
  args: {
    placeholder: 'Type multiple lines...',
    value: 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nThis will become scrollable when it exceeds max height.',
    minHeight: 36,
    maxHeight: 80,
    className: 'w-full p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500',
  },
}

// Auto focus enabled
export const AutoFocus: Story = {
  render: args => <AutoHeightTextareaDemo {...args} />,
  args: {
    placeholder: 'This textarea auto-focuses on mount',
    value: '',
    minHeight: 36,
    maxHeight: 96,
    autoFocus: true,
    className: 'w-full p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500',
  },
}

// With custom styling
export const CustomStyling: Story = {
  render: args => <AutoHeightTextareaDemo {...args} />,
  args: {
    placeholder: 'Custom styled textarea...',
    value: '',
    minHeight: 50,
    maxHeight: 150,
    className: 'w-full p-3 bg-gray-50 border-2 border-blue-400 rounded-xl text-lg focus:outline-none focus:bg-white focus:border-blue-600',
    wrapperClassName: 'shadow-lg',
  },
}

// Long content example
export const LongContent: Story = {
  render: args => <AutoHeightTextareaDemo {...args} />,
  args: {
    placeholder: 'Type something...',
    value: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.\n\nUt enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.\n\nDuis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.\n\nExcepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.',
    minHeight: 36,
    maxHeight: 200,
    className: 'w-full p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500',
  },
}

// Real-world example - Chat input
export const ChatInput: Story = {
  render: args => <AutoHeightTextareaDemo {...args} />,
  args: {
    placeholder: 'Type your message...',
    value: '',
    minHeight: 40,
    maxHeight: 120,
    className: 'w-full px-4 py-2 bg-gray-100 border border-gray-300 rounded-2xl text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500',
  },
}

// Real-world example - Comment box
export const CommentBox: Story = {
  render: args => <AutoHeightTextareaDemo {...args} />,
  args: {
    placeholder: 'Write a comment...',
    value: '',
    minHeight: 60,
    maxHeight: 200,
    className: 'w-full p-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
  },
}

// Interactive playground
export const Playground: Story = {
  render: args => <AutoHeightTextareaDemo {...args} />,
  args: {
    placeholder: 'Type something...',
    value: '',
    minHeight: 36,
    maxHeight: 96,
    autoFocus: false,
    className: 'w-full p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500',
    wrapperClassName: '',
  },
}
