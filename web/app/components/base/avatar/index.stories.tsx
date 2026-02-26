import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import Avatar from '.'

const meta = {
  title: 'Base/Data Display/Avatar',
  component: Avatar,
  parameters: {
    docs: {
      description: {
        component: 'Initials or image-based avatar used across contacts and member lists. Falls back to the first letter when the image fails to load.',
      },
      source: {
        language: 'tsx',
        code: `
<Avatar name="Alex Doe" avatar="https://cloud.dify.ai/logo/logo.svg" size={40} />
        `.trim(),
      },
    },
  },
  tags: ['autodocs'],
  args: {
    name: 'Alex Doe',
    avatar: 'https://cloud.dify.ai/logo/logo.svg',
    size: 40,
  },
} satisfies Meta<typeof Avatar>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithFallback: Story = {
  args: {
    avatar: null,
    name: 'Fallback',
  },
  parameters: {
    docs: {
      source: {
        language: 'tsx',
        code: `
<Avatar name="Fallback" avatar={null} size={40} />
        `.trim(),
      },
    },
  },
}

export const CustomSizes: Story = {
  render: args => (
    <div className="flex items-end gap-4">
      {[24, 32, 48, 64].map(size => (
        <div key={size} className="flex flex-col items-center gap-2">
          <Avatar {...args} size={size} avatar="https://i.pravatar.cc/96?u=size-test" />
          <span className="text-xs text-text-tertiary">
            {size}
            px
          </span>
        </div>
      ))}
    </div>
  ),
  parameters: {
    docs: {
      source: {
        language: 'tsx',
        code: `
{[24, 32, 48, 64].map(size => (
  <Avatar key={size} name="Size Test" size={size} avatar="https://i.pravatar.cc/96?u=size-test" />
))}
        `.trim(),
      },
    },
  },
}
