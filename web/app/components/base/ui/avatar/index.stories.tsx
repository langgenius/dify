import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Avatar, AvatarFallback, AvatarRoot } from '.'

const meta = {
  title: 'Base/UI/Avatar',
  component: Avatar,
  parameters: {
    docs: {
      description: {
        component: 'Initials or image-based avatar built on Base UI. Falls back to the first letter when the image fails to load.',
      },
      source: {
        language: 'tsx',
        code: `
<Avatar name="Alex Doe" avatar="https://i.pravatar.cc/96?u=avatar-default" size="xl" />
        `.trim(),
      },
    },
  },
  tags: ['autodocs'],
  args: {
    name: 'Alex Doe',
    avatar: 'https://i.pravatar.cc/96?u=avatar-default',
    size: 'xl',
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
<Avatar name="Fallback" avatar={null} size="xl" />
        `.trim(),
      },
    },
  },
}

export const AllSizes: Story = {
  render: args => (
    <div className="flex items-end gap-4">
      {(['xxs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'] as const).map(size => (
        <div key={size} className="flex flex-col items-center gap-2">
          <Avatar {...args} size={size} avatar="https://i.pravatar.cc/96?u=size-test" />
          <span className="text-xs text-text-tertiary">{size}</span>
        </div>
      ))}
    </div>
  ),
  parameters: {
    docs: {
      source: {
        language: 'tsx',
        code: `
{(['xxs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'] as const).map(size => (
  <Avatar key={size} name="Size Test" size={size} avatar="https://i.pravatar.cc/96?u=size-test" />
))}
        `.trim(),
      },
    },
  },
}

export const AllFallbackSizes: Story = {
  render: args => (
    <div className="flex items-end gap-4">
      {(['xxs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'] as const).map(size => (
        <div key={size} className="flex flex-col items-center gap-2">
          <Avatar {...args} size={size} avatar={null} name="Alex" />
          <span className="text-xs text-text-tertiary">{size}</span>
        </div>
      ))}
    </div>
  ),
}

export const ComposedFallback: Story = {
  render: () => (
    <AvatarRoot size="xl">
      <AvatarFallback size="xl" style={{ backgroundColor: '#2563eb' }}>
        C
      </AvatarFallback>
    </AvatarRoot>
  ),
  parameters: {
    docs: {
      source: {
        language: 'tsx',
        code: `
<AvatarRoot size="xl">
  <AvatarFallback size="xl" style={{ backgroundColor: '#2563eb' }}>
    C
  </AvatarFallback>
</AvatarRoot>
        `.trim(),
      },
    },
  },
}
