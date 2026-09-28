import type { Props as CodeEditorProps } from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { screen } from '@testing-library/react'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import ResultPanel from '../result'
import { createLogResponse } from './fixtures'

vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', async () => {
  const { serializeCodeEditorValue } =
    await import('@/app/components/workflow/nodes/_base/components/editor/code-editor/utils')
  return {
    default: ({ title, value, isJSONStringifyBeauty }: CodeEditorProps) => (
      <section>
        {title}
        <pre>{serializeCodeEditorValue(value, isJSONStringifyBeauty)}</pre>
      </section>
    ),
  }
})

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({ formatTime: () => '2024-03-12 10:00' }),
}))

describe('Agent log result', () => {
  it('renders the server metadata and preserves the chat output as text', () => {
    const meta = {
      ...createLogResponse().meta,
      elapsed_time: 1.23456,
      total_tokens: 150,
      iterations: 3,
      executor: 'User Name',
    }
    render(
      <ResultPanel
        meta={meta}
        inputs={{ query: 'input' }}
        outputs="A plain answer"
        tools={['search', 'calendar']}
      />,
    )
    expect(screen.getByText('User Name')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('1.235s')
    expect(screen.getByRole('status')).toHaveTextContent('150 Tokens')
    expect(screen.getByText('appDebug.agent.agentModeType.functionCall')).toBeInTheDocument()
    expect(screen.getByText('search, calendar')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('2024-03-12 10:00')).toBeInTheDocument()
    expect(screen.getByText('OUTPUT').parentElement?.querySelector('pre')?.textContent).toBe(
      'A plain answer',
    )
    expect(screen.getByText('INPUT').parentElement?.querySelector('pre')?.textContent).toBe(
      JSON.stringify({ query: 'input' }, null, 2),
    )
  })

  it.each([false, 0, null])('shows the JSON input %s', (inputs) => {
    render(
      <ResultPanel meta={createLogResponse().meta} inputs={inputs} outputs="Answer" tools={[]} />,
    )
    expect(screen.getByText('INPUT').parentElement?.querySelector('pre')?.textContent).toBe(
      JSON.stringify(inputs),
    )
  })

  it.each(['react', null])('handles the agent mode %s and empty tool list', (agentMode) => {
    render(
      <ResultPanel
        meta={{ ...createLogResponse().meta, agent_mode: agentMode }}
        inputs={{}}
        outputs="Answer"
        tools={[]}
      />,
    )
    expect(screen.getByText('appDebug.agent.agentModeType.ReACT')).toBeInTheDocument()
    expect(screen.getByText('Null')).toBeInTheDocument()
  })
})
