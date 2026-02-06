/* eslint-disable tailwindcss/classnames-order */
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import Effect from '.'

const meta = {
  title: 'Base/Other/Effect',
  component: Effect,
  parameters: {
    docs: {
      description: {
        component: 'Blurred circular glow used as a decorative background accent. Combine with relatively positioned containers.',
      },
      source: {
        language: 'tsx',
        code: `
<div className="relative h-40 w-72 overflow-hidden rounded-2xl bg-background-default-subtle">
  <Effect className="top-6 left-8" />
</div>
        `.trim(),
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof Effect>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {
  render: () => (
    <div className="relative h-40 w-72 overflow-hidden rounded-2xl border border-divider-subtle bg-background-default-subtle">
      <Effect className="top-6 left-8" />
      <Effect className="top-14 right-10 bg-util-colors-purple-brand-purple-brand-500" />
      <div className="absolute inset-x-0 bottom-4 flex justify-center text-xs text-text-secondary">
        Accent glow
      </div>
    </div>
  ),
}
