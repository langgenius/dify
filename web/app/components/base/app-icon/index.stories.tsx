import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import type { ComponentProps } from 'react'
import { fn } from 'storybook/test'
import AppIcon from '.'

const onChooseIcon = fn()

const meta = {
  title: 'Base/General/AppIcon',
  component: AppIcon,
  parameters: {
    docs: {
      description: {
        component:
          'Reusable avatar for applications and workflows. Supports emoji or uploaded imagery, rounded-sm mode, edit overlays, and multiple sizes.',
      },
    },
  },
  tags: ['autodocs'],
  args: {
    icon: '🧭',
    background: '#FFEAD5',
    size: 'medium',
    rounded: false,
  },
} satisfies Meta<typeof AppIcon>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <div className="flex items-center gap-4">
      <AppIcon {...args} />
      <AppIcon {...args} rounded icon="🧠" background="#E0F2FE" />
    </div>
  ),
  parameters: {
    docs: {
      source: {
        language: 'tsx',
        code: `
<AppIcon icon="🧭" background="#FFEAD5" />
<AppIcon icon="🧠" background="#E0F2FE" rounded />
        `.trim(),
      },
    },
  },
}

export const Sizes: Story = {
  render: (args) => {
    const sizes: Array<ComponentProps<typeof AppIcon>['size']> = [
      'xs',
      'tiny',
      'small',
      'medium',
      'large',
      'xl',
      'xxl',
    ]
    return (
      <div className="flex flex-wrap items-end gap-4">
        {sizes.map((size) => (
          <div key={size} className="flex flex-col items-center gap-2">
            <AppIcon {...args} size={size} icon="🚀" background="#E5DEFF" />
            <span className="text-xs text-text-tertiary uppercase">{size}</span>
          </div>
        ))}
      </div>
    )
  },
  parameters: {
    docs: {
      source: {
        language: 'tsx',
        code: `
{(['xs','tiny','small','medium','large','xl','xxl'] as const).map(size => (
  <AppIcon key={size} size={size} icon="🚀" background="#E5DEFF" />
))}
        `.trim(),
      },
    },
  },
}

export const WithEditOverlay: Story = {
  render: (args) => (
    <div className="flex items-center gap-4">
      <button
        type="button"
        aria-label="Choose emoji icon"
        className="group/edit-icon rounded-lg focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
        onClick={onChooseIcon}
      >
        <AppIcon {...args} decorative icon="🛠️" background="#E7F5FF" showEditIcon />
      </button>
      <button
        type="button"
        aria-label="Choose image icon"
        className="group/edit-icon rounded-lg focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
        onClick={onChooseIcon}
      >
        <AppIcon
          {...args}
          decorative
          iconType="image"
          background={undefined}
          imageUrl="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80' rx='16' fill='%23CBD5F5'/><text x='50%' y='54%' dominant-baseline='middle' text-anchor='middle' font-size='30' font-family='Arial' fill='%231f2937'>AI</text></svg>"
          showEditIcon
        />
      </button>
    </div>
  ),
  parameters: {
    docs: {
      source: {
        language: 'tsx',
        code: `
<button type="button" aria-label="Choose icon">
  <AppIcon decorative icon="🛠️" background="#E7F5FF" showEditIcon />
</button>
        `.trim(),
      },
    },
  },
}
