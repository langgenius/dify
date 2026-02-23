import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import ShareQRCode from '.'

const QRDemo = ({
  content = 'https://dify.ai',
}: {
  content?: string
}) => {
  return (
    <div className="flex w-full max-w-sm flex-col gap-3 rounded-2xl border border-divider-subtle bg-components-panel-bg p-6">
      <p className="text-xs uppercase tracking-[0.18em] text-text-tertiary">Share QR</p>
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <span>Generated URL:</span>
        <code className="rounded-md bg-background-default px-2 py-1 text-[11px]">{content}</code>
      </div>
      <ShareQRCode content={content} />
    </div>
  )
}

const meta = {
  title: 'Base/Data Display/QRCode',
  component: QRDemo,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Toggleable QR code generator for sharing app URLs. Clicking the trigger reveals the code with a download CTA.',
      },
    },
  },
  argTypes: {
    content: {
      control: 'text',
    },
  },
  args: {
    content: 'https://dify.ai',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof QRDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

export const DemoLink: Story = {
  args: {
    content: 'https://dify.ai/docs',
  },
}
