import { userEvent } from 'vite-plus/test/browser'
import ResultPanel from '../result'
import { renderAgentLog } from './browser-test-env'

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
  iterations: 12,
}

it('shows semantic input, output and execution metadata in keyboard-reachable readonly editors', async () => {
  const { screen } = await renderAgentLog(<ResultPanel {...props} />)
  await expect.element(screen.getByText('"query"')).toBeVisible()
  await expect.element(screen.getByText('"input"')).toBeVisible()
  await expect.element(screen.getByText('"answer"')).toBeVisible()
  await expect.element(screen.getByText('"output"')).toBeVisible()
  const editorLocator = screen.getByRole('textbox', { name: 'Editor content' })
  await expect.poll(() => editorLocator.all().length).toBe(2)
  const editors = editorLocator.all()
  for (const editor of editors) await expect.element(editor).toHaveAttribute('readonly')

  await screen.getByText('"input"').click()
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
  await expect.element(screen.getByText('12', { exact: true })).toBeVisible()
})
