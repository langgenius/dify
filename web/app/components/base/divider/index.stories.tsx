import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import Divider from '.'

const meta = {
  title: 'Base/Layout/Divider',
  component: Divider,
  parameters: {
    docs: {
      description: {
        component: 'Lightweight separator supporting horizontal and vertical orientations with gradient or solid backgrounds.',
      },
      source: {
        language: 'tsx',
        code: `
<Divider />
        `.trim(),
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof Divider>

export default meta
type Story = StoryObj<typeof meta>

export const Horizontal: Story = {}

export const Vertical: Story = {
  render: args => (
    <div className="flex h-20 items-center gap-4 rounded-lg border border-divider-subtle bg-components-panel-bg p-4">
      <span className="text-sm text-text-secondary">Filters</span>
      <Divider {...args} type="vertical" />
      <span className="text-sm text-text-secondary">Tags</span>
    </div>
  ),
  parameters: {
    docs: {
      source: {
        language: 'tsx',
        code: `
<Divider type="vertical" />
        `.trim(),
      },
    },
  },
}
