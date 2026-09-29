import type { AgentToolCallResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { Props as CodeEditorProps } from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocale } from '#i18n'
import ToolCallItem from '../tool-call'
import { createToolCall } from './fixtures'

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

vi.mock('#i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#i18n')>()),
  useLocale: vi.fn(() => 'en-US'),
}))

beforeEach(() => {
  vi.mocked(useLocale).mockReturnValue('en-US')
})

describe('Agent tool logs', () => {
  it.each<{
    label: AgentToolCallResponse['tool_label']
    expected: string
  }>([
    { label: 'Plain tool label', expected: 'Plain tool label' },
    { label: { 'en-US': 'Localized tool' }, expected: 'Localized tool' },
    { label: { en_US: 'Underscore tool' }, expected: 'Underscore tool' },
    { label: { fr_FR: 'Recherche' }, expected: 'search' },
  ])('renders the display name for $label', ({ label, expected }) => {
    render(<ToolCallItem isLLM={false} toolCall={createToolCall({ tool_label: label })} />)
    expect(screen.getByRole('button', { name: new RegExp(expected) })).toBeInTheDocument()
  })

  it('selects the current locale rather than another available language', () => {
    vi.mocked(useLocale).mockReturnValue('zh-Hans')
    render(
      <ToolCallItem
        isLLM={false}
        toolCall={createToolCall({ tool_label: { en_US: 'Search', zh_Hans: '搜索' } })}
      />,
    )
    expect(screen.getByRole('button', { name: /搜索/ })).toBeInTheDocument()
  })

  it.each([
    { value: 'A plain tool result', expected: 'A plain tool result' },
    { value: false, expected: 'false' },
    { value: 0, expected: '0' },
    { value: null, expected: 'null' },
    { value: { result: ['one', 2] }, expected: JSON.stringify({ result: ['one', 2] }, null, 2) },
  ])(
    'shows the tool JSON output $value without losing or quoting scalar text',
    async ({ value, expected }) => {
      const user = userEvent.setup()
      render(<ToolCallItem isLLM={false} toolCall={createToolCall({ tool_output: value })} />)
      const toggle = screen.getByRole('button', { name: /Search/ })
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByText('OUTPUT')).not.toBeInTheDocument()
      await user.click(toggle)
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByText('OUTPUT').parentElement?.querySelector('pre')?.textContent).toBe(
        expected,
      )
      await user.click(toggle)
      expect(screen.queryByText('OUTPUT')).not.toBeInTheDocument()
    },
  )

  it.each([false, 0, null])('retains the tool input %s', async (toolInput) => {
    const user = userEvent.setup()
    render(<ToolCallItem isLLM={false} toolCall={createToolCall({ tool_input: toolInput })} />)
    await user.click(screen.getByRole('button', { name: /Search/ }))
    expect(screen.getByText('INPUT').parentElement?.querySelector('pre')?.textContent).toBe(
      JSON.stringify(toolInput),
    )
  })

  it('opens through the keyboard and shows the tool failure', async () => {
    const user = userEvent.setup()
    render(
      <ToolCallItem
        isLLM={false}
        toolCall={createToolCall({ status: 'error', error: 'Permission denied' })}
      />,
    )
    await user.tab()
    expect(screen.getByRole('button', { name: /Search/ })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByText('Permission denied')).toBeInTheDocument()
  })

  it('accepts an error result with no error message', async () => {
    const user = userEvent.setup()
    render(
      <ToolCallItem
        isLLM={false}
        toolCall={createToolCall({ status: 'error', error: null, tool_output: 'Tool failed' })}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Search/ }))
    expect(screen.getByText('Tool failed')).toBeInTheDocument()
  })

  it.each([
    { time: 0.5, expected: '500.000 ms' },
    { time: 1.5, expected: '1.500 s' },
    { time: 65, expected: '1 m 5.000 s' },
  ])('formats a $time second duration', ({ time, expected }) => {
    render(<ToolCallItem isLLM={false} toolCall={createToolCall({ time_cost: time })} />)
    expect(screen.getByText(expected)).toBeInTheDocument()
  })
})

describe('Agent LLM iterations', () => {
  it.each([
    { isFinal: false, label: 'THOUGHT' },
    { isFinal: true, label: 'FINAL ANSWER' },
  ])('shows the $label and raw observation as text', async ({ isFinal, label }) => {
    const user = userEvent.setup()
    render(
      <ToolCallItem
        isLLM
        isFinal={isFinal}
        tokens={1200}
        observation="Raw observation"
        finalAnswer="A useful answer"
      />,
    )
    expect(screen.getByText('1.2K tokens')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /LLM/ }))
    expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.getByText('Raw observation')).toBeInTheDocument()
    expect(screen.getByText('A useful answer')).toBeInTheDocument()
    expect(screen.queryByText('INPUT')).not.toBeInTheDocument()
    expect(screen.queryByText('OUTPUT')).not.toBeInTheDocument()
  })

  it('accepts nullable thought and observation without fabricating a token count', async () => {
    const user = userEvent.setup()
    render(<ToolCallItem isLLM isFinal tokens={null} observation={null} finalAnswer={null} />)
    expect(screen.queryByText(/tokens/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /LLM/ }))
    expect(
      screen.getByText('FINAL ANSWER').parentElement?.querySelector('pre'),
    ).toBeEmptyDOMElement()
    expect(
      screen.getByText('OBSERVATION').parentElement?.querySelector('pre'),
    ).toBeEmptyDOMElement()
  })
})
