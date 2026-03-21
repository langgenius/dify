import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import Flowchart from '.'

const SAMPLE = `
flowchart LR
  A[User Message] --> B{Agent decides}
  B -->|Needs tool| C[Search Tool]
  C --> D[Combine result]
  B -->|Direct answer| D
  D --> E[Send response]
`

const MermaidDemo = ({
  theme = 'light',
}: {
  theme?: 'light' | 'dark'
}) => {
  const [currentTheme, setCurrentTheme] = useState<'light' | 'dark'>(theme)

  return (
    <div className="flex w-full max-w-3xl flex-col gap-4 rounded-2xl border border-divider-subtle bg-components-panel-bg p-6">
      <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-text-tertiary">
        <span>Mermaid diagram</span>
        <button
          type="button"
          className="rounded-md border border-divider-subtle bg-background-default px-3 py-1 text-xs font-medium text-text-secondary hover:bg-state-base-hover"
          onClick={() => setCurrentTheme(prev => (prev === 'light' ? 'dark' : 'light'))}
        >
          Toggle theme
        </button>
      </div>
      <Flowchart PrimitiveCode={SAMPLE.trim()} theme={currentTheme} />
    </div>
  )
}

const meta = {
  title: 'Base/Data Display/Mermaid',
  component: MermaidDemo,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Mermaid renderer with custom theme toggle and caching. Useful for visualizing agent flows.',
      },
    },
  },
  argTypes: {
    theme: {
      control: 'inline-radio',
      options: ['light', 'dark'],
    },
  },
  args: {
    theme: 'light',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof MermaidDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}
