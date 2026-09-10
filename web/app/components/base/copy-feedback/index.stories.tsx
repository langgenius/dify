import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { CopyFeedback } from '.'

const meta = {
  title: 'Base/Feedback/CopyFeedback',
  component: CopyFeedback,
  parameters: {
    docs: {
      description: {
        component: 'Copy-to-clipboard icon buttons that show instant feedback and a tooltip.',
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
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <span>Client ID:</span>
        <span className="rounded-sm bg-background-default-subtle px-2 py-1 font-mono text-xs text-text-primary">
          {content}
        </span>
        <CopyFeedback content={content} />
      </div>
    </div>
  )
}

export const Playground: Story = {
  render: (args) => <CopyDemo content={args.content} />,
  parameters: {
    docs: {
      source: {
        language: 'tsx',
        code: `
<CopyFeedback content="acc-3f92fa" />
        `.trim(),
      },
    },
  },
}
