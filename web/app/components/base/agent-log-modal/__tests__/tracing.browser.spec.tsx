import type { AgentIterationLogResponse } from '@dify/contracts/api/console/apps/types.gen'
import { page } from 'vite-plus/test/browser'
import TracingPanel from '../tracing'
import { renderAgentLog } from './browser-test-env'

const createIteration = (thought: string, tokens: number): AgentIterationLogResponse => ({
  created_at: '',
  files: [],
  thought,
  tokens,
  tool_calls: [
    {
      tool_name: 'tool1',
      status: 'success',
      tool_icon: null,
      tool_label: { 'en-US': 'Tool 1' },
      time_cost: 0,
      tool_input: {},
      tool_output: {},
      tool_parameters: {},
    },
  ],
  tool_raw: { inputs: '', outputs: '' },
})

it('keeps trace output ordered and exposes only the last thought as the final answer', async () => {
  await page.viewport(800, 500)
  const { screen } = await renderAgentLog(
    <TracingPanel
      list={[
        createIteration('Thought 1', 10),
        createIteration('Thought 2', 20),
        createIteration('Thought 3', 30),
      ]}
    />,
  )
  const iterations = screen.getByText(/ITERATION/i).all()
  expect(iterations).toHaveLength(2)
  await expect.element(iterations[0]!).toHaveTextContent('APPLOG.AGENTLOGDETAIL.ITERATION 1')
  await expect.element(iterations[1]!).toHaveTextContent('APPLOG.AGENTLOGDETAIL.ITERATION 2')
  await expect.element(screen.getByText(/finalProcessing/i)).toBeVisible()

  for (const llm of screen.getByText('LLM').all()) await llm.click()
  // Each editor title precedes its rendered value, so one document-order read proves both the
  // iteration order and that only the last thought is labelled as the final answer.
  const titlesAndValues = screen.getByText(
    /^(?:OBSERVATION|THOUGHT|FINAL ANSWER|""|"Thought\s\d")$/,
  )
  await expect
    // Monaco renders spaces as non-breaking spaces.
    .poll(() =>
      titlesAndValues
        .all()
        .map((element) => element.element().textContent?.replaceAll('\u00A0', ' ')),
    )
    .toEqual([
      'OBSERVATION',
      '""',
      'THOUGHT',
      '"Thought 1"',
      'OBSERVATION',
      '""',
      'THOUGHT',
      '"Thought 2"',
      'OBSERVATION',
      '""',
      'FINAL ANSWER',
      '"Thought 3"',
    ])
  await expect.element(screen.getByText('FINAL ANSWER')).toBeVisible()
  const editors = screen.getByRole('textbox', { name: 'Editor content' })
  await expect.poll(() => editors.all().length).toBe(6)
  for (const editor of editors.all()) await expect.element(editor).toHaveAttribute('readonly')
})
