import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import type { AppIconProps } from '.'
import AppIcon from '.'

const meta = {
  title: 'Base/General/AppIcon',
  component: AppIcon,
  parameters: {
    docs: {
      description: {
        component:
          'Application identity display built on Avatar. Sources are emoji or image URLs; editing belongs to IconPicker.',
      },
    },
  },
  tags: ['autodocs'],
  args: {
    icon: { icon_type: 'emoji', icon: '🧭', icon_background: '#FFEAD5' },
    size: 'medium',
    shape: 'square',
  },
} satisfies Meta<typeof AppIcon>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <div className="flex items-center gap-4">
      <AppIcon {...args} />
      <AppIcon
        {...args}
        shape="circle"
        icon={{ icon_type: 'emoji', icon: '🧠', icon_background: '#E0F2FE' }}
      />
    </div>
  ),
}

export const Sizes: Story = {
  render: (args) => {
    const sizes: AppIconProps['size'][] = ['xs', 'tiny', 'small', 'medium', 'large', 'xl', 'xxl']
    return (
      <div className="flex flex-wrap items-end gap-4">
        {sizes.map((size) => (
          <div key={size} className="flex flex-col items-center gap-2">
            <AppIcon {...args} size={size} />
            <span className="text-xs text-text-tertiary uppercase">{size}</span>
          </div>
        ))}
      </div>
    )
  },
}

export const ImageFallback: Story = {
  args: {
    icon: { icon_type: 'image', icon_url: 'data:image/png;base64,broken' },
    fallback: { content: '📙', background: '#FFF4ED' },
    decorative: false,
    label: 'Knowledge base',
  },
}
