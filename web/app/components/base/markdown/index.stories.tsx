import type { Meta, StoryObj } from '@storybook/nextjs'
import { useState } from 'react'
import { Markdown } from '.'

const SAMPLE_MD = `
# Product Update

Our agent now supports **tool-runs** with structured outputs.

## Highlights
- Faster reasoning with \\(O(n \\log n)\\) planning.
- Inline chain-of-thought:

<details data-think>
<summary>Thinking aloud</summary>

Check cached metrics first.  
If missing, fetch raw warehouse data.  
[ENDTHINKFLAG]

</details>

## Mermaid Diagram
\`\`\`mermaid
graph TD
  Start[User Message] --> Parse{Detect Intent?}
  Parse -->|Tool| ToolCall[Call search tool]
  Parse -->|Answer| Respond[Stream response]
  ToolCall --> Respond
\`\`\`

## Code Example
\`\`\`typescript
const reply = await client.chat({
  message: 'Summarise weekly metrics.',
  tags: ['analytics'],
})
\`\`\`
`

const MarkdownDemo = ({
  compact = false,
}: {
  compact?: boolean
}) => {
  const [content] = useState(SAMPLE_MD.trim())

  return (
    <div className="flex w-full max-w-3xl flex-col gap-4 rounded-2xl border border-divider-subtle bg-components-panel-bg p-6">
      <div className="text-xs uppercase tracking-[0.18em] text-text-tertiary">Markdown renderer</div>
      <Markdown
        content={content}
        className={compact ? '!text-sm leading-relaxed' : ''}
      />
    </div>
  )
}

const meta = {
  title: 'Base/Data Display/Markdown',
  component: MarkdownDemo,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Markdown wrapper with GitHub-flavored markdown, Mermaid diagrams, math, and custom blocks (details, audio, etc.).',
      },
    },
  },
  argTypes: {
    compact: { control: 'boolean' },
  },
  args: {
    compact: false,
  },
  tags: ['autodocs'],
} satisfies Meta<typeof MarkdownDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

export const Compact: Story = {
  args: {
    compact: true,
  },
}
