import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import CopyIcon from '.'

const meta = {
  title: 'Base/General/CopyIcon',
  component: CopyIcon,
  parameters: {
    docs: {
      description: {
        component: 'Interactive copy-to-clipboard glyph that swaps to a checkmark once the content has been copied. Tooltips rely on the app locale.',
      },
    },
  },
  tags: ['autodocs'],
  args: {
    content: 'https://console.dify.ai/apps/12345',
  },
} satisfies Meta<typeof CopyIcon>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: args => (
    <div className="flex items-center gap-2 rounded-lg border border-divider-subtle bg-components-panel-bg p-4 text-sm text-text-secondary">
      <span>Hover or click to copy the app link:</span>
      <CopyIcon {...args} />
    </div>
  ),
  parameters: {
    docs: {
      source: {
        language: 'tsx',
        code: `
<div className="flex items-center gap-2">
  <span>Hover or click to copy the app link:</span>
  <CopyIcon content="https://console.dify.ai/apps/12345" />
</div>
        `.trim(),
      },
    },
  },
}

export const InlineUsage: Story = {
  render: args => (
    <div className="space-y-3 text-sm text-text-secondary">
      <p>
        Use the copy icon inline with labels or metadata. Clicking the icon copies the value to the clipboard and shows a success tooltip.
      </p>
      <div className="flex items-center gap-1">
        <span className="font-medium text-text-primary">Client ID</span>
        <span className="rounded bg-background-default-subtle px-2 py-1 font-mono text-xs text-text-secondary">acc-3f92fa</span>
        <CopyIcon {...args} content="acc-3f92fa" />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      source: {
        language: 'tsx',
        code: `
<CopyIcon content="acc-3f92fa" />
        `.trim(),
      },
    },
  },
}
