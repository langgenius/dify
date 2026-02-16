import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import EmojiPickerInner from './Inner'

const meta = {
  title: 'Base/Data Entry/EmojiPickerInner',
  component: EmojiPickerInner,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Core emoji grid with search and style swatches. Use this when embedding the selector inline without a modal frame.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof EmojiPickerInner>

export default meta
type Story = StoryObj<typeof meta>

const InnerDemo = () => {
  const [selection, setSelection] = useState<{ emoji: string, background: string } | null>(null)

  return (
    <div className="flex h-[520px] flex-col gap-4 rounded-xl border border-divider-subtle bg-components-panel-bg p-6 shadow-lg">
      <EmojiPickerInner
        onSelect={(emoji, background) => setSelection({ emoji, background })}
        className="flex-1 overflow-hidden rounded-xl border border-divider-subtle bg-white"
      />
      <div className="rounded-lg border border-divider-subtle bg-background-default-subtle p-3 text-xs text-text-secondary">
        <div className="font-medium text-text-primary">Latest selection</div>
        <pre className="mt-1 max-h-40 overflow-auto font-mono">
          {selection ? JSON.stringify(selection, null, 2) : 'Tap an emoji to set background options.'}
        </pre>
      </div>
    </div>
  )
}

export const Playground: Story = {
  render: () => <InnerDemo />,
  parameters: {
    docs: {
      source: {
        language: 'tsx',
        code: `
const [selection, setSelection] = useState<{ emoji: string; background: string } | null>(null)

return (
  <EmojiPickerInner onSelect={(emoji, background) => setSelection({ emoji, background })} />
)
        `.trim(),
      },
    },
  },
}
