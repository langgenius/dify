import { userEvent } from 'vite-plus/test/browser'
import ResultPanel from '../result'
import { renderAgentLog } from './browser-test-env'

vi.mock('@monaco-editor/react', async () => {
  const { createMonacoEditorModuleMock } = await import('@/test/monaco-editor-mock')
  return createMonacoEditorModuleMock()
})

const props = {
  status: 'success',
  elapsed_time: 1.23456,
  total_tokens: 150,
  error: '',
  inputs: { query: 'input' },
  outputs: { answer: 'output' },
  created_by: 'User Name',
  created_at: '2023-01-01T00:00:00Z',
  agentMode: 'function_call',
  tools: ['tool1', 'tool2'],
  iterations: 3,
}

it('shows semantic input, output and execution metadata in keyboard-reachable readonly editors', async () => {
  const { screen } = await renderAgentLog(<ResultPanel {...props} />)
  const editors = screen.getByTestId('monaco-editor').all()
  expect(editors).toHaveLength(2)
  await expect.element(editors[0]!).toHaveValue(JSON.stringify(props.inputs, null, 2))
  await expect.element(editors[1]!).toHaveValue(JSON.stringify(props.outputs, null, 2))
  for (const editor of editors) await expect.element(editor).toHaveAttribute('readonly')

  await editors[0]!.click()
  await expect.element(editors[0]!).toHaveFocus()
  await userEvent.keyboard('{Tab}')
  const resizeControls = screen.getByRole('button', { name: 'common.resize.editor' }).all()
  await expect.element(resizeControls[0]!).toHaveFocus()
  await userEvent.keyboard('{Tab}')
  const copyControls = screen.getByRole('button', { name: 'common.operation.copy' }).all()
  expect(copyControls).toHaveLength(2)
  for (const copy of copyControls) await expect.element(copy).toBeVisible()
  expect(copyControls.some((copy) => copy.element() === document.activeElement)).toBe(true)
  await expect.element(screen.getByText('User Name')).toBeVisible()
  await expect.element(screen.getByRole('status')).toMatchTextContent('appLog.status.succeeded')
  await expect.element(screen.getByRole('status')).toMatchTextContent('1.235s')
  await expect.element(screen.getByRole('status')).toMatchTextContent('150 Tokens')
  await expect.element(screen.getByText('appDebug.agent.agentModeType.functionCall')).toBeVisible()
  await expect.element(screen.getByText('tool1, tool2')).toBeVisible()
  await expect.element(screen.getByText('3', { exact: true })).toBeVisible()
})

it('shows the available mode and fallbacks when execution metadata is missing', async () => {
  const { screen } = await renderAgentLog(
    <ResultPanel
      {...props}
      created_by={undefined}
      tools={[]}
      total_tokens={undefined}
      agentMode="react"
    />,
  )
  await expect.element(screen.getByText('N/A')).toBeVisible()
  await expect.element(screen.getByText('Null')).toBeVisible()
  await expect.element(screen.getByRole('status')).toMatchTextContent('0 Tokens')
  await expect.element(screen.getByText('appDebug.agent.agentModeType.ReACT')).toBeVisible()
})
