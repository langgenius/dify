import type { Meta, StoryObj } from '@storybook/nextjs'
import { useState } from 'react'
import CopyFeedback, { CopyFeedbackNew } from '.'

const meta = {
  title: 'Base/Feedback/CopyFeedback',
  component: CopyFeedback,
  parameters: {
    docs: {
      description: {
        component: 'Copy-to-clipboard button that shows instant feedback and a tooltip. Includes the original ActionButton wrapper and the newer ghost-button variant.',
      },
    },
  },
  tags: ['autodocs'],
  args: {
    content: 'acc-3f92fa',
  },
} satisfies Meta<typeof CopyFeedback>

export default meta
type Story = StoryObj<typeof meta>

const CopyDemo = ({ content }: { content: string }) => {
  const [value] = useState(content)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <span>Client ID:</span>
        <span className="rounded bg-background-default-subtle px-2 py-1 font-mono text-xs text-text-primary">{value}</span>
        <CopyFeedback content={value} />
      </div>
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <span>Use the new ghost variant:</span>
        <CopyFeedbackNew content={value} />
      </div>
    </div>
  )
}

export const Playground: Story = {
  render: args => <CopyDemo content={args.content} />,
  parameters: {
    docs: {
      source: {
        language: 'tsx',
        code: `
<CopyFeedback content="acc-3f92fa" />
<CopyFeedbackNew content="acc-3f92fa" />
        `.trim(),
      },
    },
  },
}
