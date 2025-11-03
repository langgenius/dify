import type { Meta, StoryObj } from '@storybook/nextjs'
import CodeBlock from './code-block'

const SAMPLE_CODE = `const greet = (name: string) => {
  return \`Hello, \${name}\`
}

console.log(greet('Dify'))`

const CodeBlockDemo = ({
  language = 'typescript',
}: {
  language?: string
}) => {
  return (
    <div className="flex w-full max-w-xl flex-col gap-4 rounded-2xl border border-divider-subtle bg-components-panel-bg p-6">
      <div className="text-xs uppercase tracking-[0.18em] text-text-tertiary">Code block</div>
      <CodeBlock
        className={`language-${language}`}
      >
        {SAMPLE_CODE}
      </CodeBlock>
    </div>
  )
}

const meta = {
  title: 'Base/Data Display/CodeBlock',
  component: CodeBlockDemo,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Syntax highlighted code block with copy button and SVG toggle support.',
      },
    },
  },
  argTypes: {
    language: {
      control: 'radio',
      options: ['typescript', 'json', 'mermaid'],
    },
  },
  args: {
    language: 'typescript',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof CodeBlockDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

export const Mermaid: Story = {
  args: {
    language: 'mermaid',
  },
  render: ({ language }) => (
    <div className="flex w-full max-w-xl flex-col gap-4 rounded-2xl border border-divider-subtle bg-components-panel-bg p-6">
      <CodeBlock className={`language-${language}`}>
        {`graph TD
  Start --> Decision{User message?}
  Decision -->|Tool| ToolCall[Call web search]
  Decision -->|Respond| Answer[Compose draft]
`}
      </CodeBlock>
    </div>
  ),
}
