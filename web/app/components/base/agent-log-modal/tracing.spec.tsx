import type { AgentIteration } from '@/models/log'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import TracingPanel from './tracing'

vi.mock('@/app/components/workflow/block-icon', () => ({
  default: () => <div data-testid="block-icon" />,
}))

vi.mock('@/app/components/base/icons/src/vender/line/arrows', () => ({
  ChevronRight: (props: { className?: string }) => <div data-testid="chevron-right" className={props.className} />,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: ({ title, value }: { title: React.ReactNode, value: string | object }) => (
    <div data-testid="code-editor">
      {title}
      {typeof value === 'string' ? value : JSON.stringify(value)}
    </div>
  ),
}))

const createIteration = (thought: string, tokens: number): AgentIteration => ({
  created_at: '',
  files: [],
  thought,
  tokens,
  tool_calls: [{ tool_name: 'tool1', status: 'success', tool_icon: null, tool_label: { 'en-US': 'Tool 1' } }],
  tool_raw: { inputs: '', outputs: '' },
})

const mockList: AgentIteration[] = [
  createIteration('Thought 1', 10),
  createIteration('Thought 2', 20),
  createIteration('Thought 3', 30),
]

describe('TracingPanel', () => {
  it('should render all iterations in the list', () => {
    render(<TracingPanel list={mockList} />)

    expect(screen.getByText(/finalProcessing/i)).toBeInTheDocument()
    expect(screen.getAllByText(/ITERATION/i).length).toBe(2)
  })

  it('should render empty list correctly', () => {
    const { container } = render(<TracingPanel list={[]} />)
    expect(container.querySelector('.bg-background-section')?.children.length).toBe(0)
  })
})
