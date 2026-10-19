import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { MermaidDiagram } from '.'

const meta = {
  title: 'Base/Data Display/MermaidDiagram',
  component: MermaidDiagram,
  args: {
    source:
      'flowchart LR\n A[用户输入] --> B{知识检索}\n B --> C[生成回答]\n B --> D[调用工具]\n D --> C',
  },
  decorators: [
    (Story) => (
      <div className="w-full max-w-3xl">
        <Story />
      </div>
    ),
  ],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof MermaidDiagram>

export default meta
type Story = StoryObj<typeof meta>

export const Flowchart: Story = {}
export const Narrow: Story = {
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
}
export const Sequence: Story = {
  args: {
    source:
      'sequenceDiagram\n participant User\n participant Agent\n participant Knowledge\n User->>Agent: Ask a question\n Agent->>Knowledge: Retrieve context\n Knowledge-->>Agent: Relevant documents\n Agent-->>User: Answer with citations',
  },
}
export const Invalid: Story = { args: { source: 'flowchart TD\n A[' } }
