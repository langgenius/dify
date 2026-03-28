import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import CornerLabel from '.'

const meta = {
  title: 'Base/Data Display/CornerLabel',
  component: CornerLabel,
  parameters: {
    docs: {
      description: {
        component: 'Decorative label that anchors to card corners. Useful for marking “beta”, “deprecated”, or similar callouts.',
      },
      source: {
        language: 'tsx',
        code: `
<CornerLabel label="beta" />
        `.trim(),
      },
    },
  },
  tags: ['autodocs'],
  args: {
    label: 'beta',
  },
} satisfies Meta<typeof CornerLabel>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const OnCard: Story = {
  render: args => (
    <div className="relative w-80 rounded-2xl border border-divider-subtle bg-components-panel-bg p-6">
      <CornerLabel {...args} className="absolute right-[-1px] top-[-1px]" />
      <div className="text-sm text-text-secondary">
        Showcase how the label sits on a card header. Pair with contextual text or status information.
      </div>
    </div>
  ),
  parameters: {
    docs: {
      source: {
        language: 'tsx',
        code: `
<div className="relative">
  <CornerLabel label="beta" className="absolute left-[-1px] top-[-1px]" />
  ...card content...
</div>
        `.trim(),
      },
    },
  },
}
