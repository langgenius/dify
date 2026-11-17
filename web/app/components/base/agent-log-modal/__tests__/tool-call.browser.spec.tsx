import { useLocale } from '#i18n'
import ToolCallItem from '../tool-call'
import { renderAgentLog } from './browser-test-env'

vi.mock('@monaco-editor/react', async () => {
  const { createMonacoEditorModuleMock } = await import('@/test/monaco-editor-mock')
  return createMonacoEditorModuleMock()
})

vi.mock('#i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#i18n')>()),
  useLocale: vi.fn(() => 'en'),
}))

const toolCall = {
  status: 'success',
  error: null,
  tool_name: 'test_tool',
  tool_label: { en: 'Test Tool Label' },
  tool_icon: 'icon',
  time_cost: 1.5,
  tool_input: { query: 'hello' },
  tool_output: { result: 'world' },
}

it('uses the underscored locale fallback and formats the elapsed time', async () => {
  vi.mocked(useLocale).mockReturnValueOnce('en-US')
  const { screen } = await renderAgentLog(
    <ToolCallItem
      toolCall={{ ...toolCall, tool_label: { en_US: 'Fallback Label' } }}
      isLLM={false}
    />,
  )
  await expect.element(screen.getByText('Fallback Label')).toBeVisible()
  await expect.element(screen.getByText('1.500 s')).toBeVisible()
})

it('formats subsecond and minute-long tool calls', async () => {
  const { screen } = await renderAgentLog(
    <>
      <ToolCallItem toolCall={{ ...toolCall, time_cost: 0.5 }} isLLM={false} />
      <ToolCallItem toolCall={{ ...toolCall, time_cost: 65 }} isLLM={false} />
    </>,
  )
  await expect.element(screen.getByText('500.000 ms')).toBeVisible()
  await expect.element(screen.getByText('1 m 5.000 s')).toBeVisible()
})

it('reveals real readonly input and output editors and hides them when collapsed', async () => {
  const { screen } = await renderAgentLog(<ToolCallItem toolCall={toolCall} isLLM={false} />)
  const trigger = screen.getByText('Test Tool Label')
  await expect.element(screen.getByTestId('monaco-editor')).not.toBeInTheDocument()
  await trigger.click()

  const editors = screen.getByTestId('monaco-editor').all()
  expect(editors).toHaveLength(2)
  await expect.element(editors[0]!).toHaveValue(JSON.stringify({ query: 'hello' }, null, 2))
  await expect.element(editors[1]!).toHaveValue(JSON.stringify({ result: 'world' }, null, 2))
  for (const editor of editors) await expect.element(editor).toHaveAttribute('readonly')
  await trigger.click()
  await expect.element(screen.getByTestId('monaco-editor')).not.toBeInTheDocument()
})

it('reveals the provider error inside the expanded tool call', async () => {
  const { screen } = await renderAgentLog(
    <ToolCallItem
      toolCall={{ ...toolCall, status: 'error', error: 'Something went wrong' }}
      isLLM={false}
    />,
  )
  await screen.getByText('Test Tool Label').click()
  await expect.element(screen.getByText('Something went wrong')).toBeVisible()
})

it.each([
  [800, '800'],
  [1200, '1.2K'],
  [1200000, '1.2M'],
] as const)('formats %s LLM tokens as %s', async (tokens, formatted) => {
  const { screen } = await renderAgentLog(
    <ToolCallItem toolCall={toolCall} isLLM tokens={tokens} />,
  )
  await expect.element(screen.getByText(`${formatted} tokens`)).toBeVisible()
})

it.each([true, false])(
  'reveals the observation and correct result title for isFinal=%s',
  async (isFinal) => {
    const { screen } = await renderAgentLog(
      <ToolCallItem
        toolCall={toolCall}
        isLLM
        observation="Tool returned a result"
        finalAnswer="Use the result"
        isFinal={isFinal}
      />,
    )
    await screen.getByText('LLM').click()
    const editors = screen.getByTestId('monaco-editor').all()
    expect(editors).toHaveLength(4)
    await expect.element(editors[2]!).toHaveValue(JSON.stringify('Tool returned a result'))
    await expect.element(editors[3]!).toHaveValue(JSON.stringify('Use the result'))
    await expect.element(screen.getByText(isFinal ? 'FINAL ANSWER' : 'THOUGHT')).toBeVisible()
    await expect
      .element(screen.getByText(isFinal ? 'THOUGHT' : 'FINAL ANSWER'))
      .not.toBeInTheDocument()
  },
)
