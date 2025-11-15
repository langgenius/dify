import type { Meta, StoryObj } from '@storybook/nextjs'
import Badge from '../badge'

const meta = {
  title: 'Base/Data Display/Badge',
  component: Badge,
  parameters: {
    docs: {
      description: {
        component: 'Compact label used for statuses and counts. Supports uppercase styling and optional red corner marks.',
      },
      source: {
        language: 'tsx',
        code: `
<Badge text="beta" />
        `.trim(),
      },
    },
  },
  tags: ['autodocs'],
  args: {
    text: 'beta',
    uppercase: true,
  },
} satisfies Meta<typeof Badge>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithCornerMark: Story = {
  args: {
    text: 'new',
    hasRedCornerMark: true,
  },
  parameters: {
    docs: {
      source: {
        language: 'tsx',
        code: `
<Badge text="new" hasRedCornerMark />
        `.trim(),
      },
    },
  },
}

export const CustomContent: Story = {
  render: args => (
    <Badge {...args} uppercase={false}>
      <span className="flex items-center gap-1">
        <span className="h-2 w-2 rounded-full bg-emerald-400" />
        Production
      </span>
    </Badge>
  ),
  parameters: {
    docs: {
      source: {
        language: 'tsx',
        code: `
<Badge uppercase={false}>
  <span className="flex items-center gap-1">
    <span className="h-2 w-2 rounded-full bg-emerald-400" />
    Production
  </span>
</Badge>
        `.trim(),
      },
    },
  },
}
