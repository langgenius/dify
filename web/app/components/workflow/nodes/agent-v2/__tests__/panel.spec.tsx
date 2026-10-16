import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { replacePromptEditorText } from '@/app/components/base/prompt-editor/plugins/__tests__/test-helpers'
import { createData, createPanelEnvironment } from './panel-test-env'

vi.mock('@/app/components/app/tracing/inherited-tracing-summary', () => ({
  InheritedTracingSummary: ({ appId }: { appId: string }) => (
    <div data-testid="inherited-tracing">{appId}</div>
  ),
}))

const outputPrefix = 'workflowAgent.nodes.agent.outputVars'
const task = () => screen.getByRole('textbox', { name: 'workflowAgent.nodes.agent.task.label' })
const outputForm = () => within(screen.getByRole('form', { name: `${outputPrefix}.editorLabel` }))
const summary = {
  name: 'summary',
  type: 'string' as const,
  required: false,
  description: 'Short summary',
}
const renderPanel = (data = createData()) => {
  const env = createPanelEnvironment({ data })
  return { ...env, ...env.render() }
}
const openOutputs = async (user: ReturnType<typeof userEvent.setup>) => {
  const trigger = screen.getByRole('button', { name: 'workflow.nodes.common.outputVars' })
  if (trigger.getAttribute('aria-expanded') !== 'true') await user.click(trigger)
  const panel = document.getElementById(trigger.getAttribute('aria-controls')!)!
  return within(panel)
}

describe('Agent task and declared outputs', () => {
  it('loads graph outputs alongside the built-in text output', async () => {
    const user = userEvent.setup()
    renderPanel(
      createData({
        agent_declared_outputs: [
          summary,
          {
            name: 'attachments',
            type: 'array',
            array_item: { type: 'file' },
            description: 'Generated files',
          },
        ],
      }),
    )
    const outputs = await openOutputs(user)
    expect(outputs.getByText('Short summary')).toBeVisible()
    expect(outputs.getByText('array[file]')).toBeVisible()
    expect(outputs.getByText('Generated files')).toBeVisible()
    expect(outputs.getByText('workflow.nodes.agent.outputVars.text')).toBeVisible()
    expect(outputs.queryByText('usage')).not.toBeInTheDocument()
  })

  it('links the task explanation to the Agent documentation', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'workflowAgent.nodes.agent.task.label' }))
    expect(
      await screen.findByRole('link', { name: 'workflowAgent.nodes.agent.task.learnMore' }),
    ).toHaveAttribute('href', expect.stringContaining('/use-dify/nodes/agent#give-it-a-task'))
  })

  it('saves task edits into the workflow graph', async () => {
    const user = userEvent.setup()
    const { getNodeData } = renderPanel()
    await user.click(task())
    await user.paste('Clarify the request')
    await waitFor(() => expect(getNodeData().agent_task).toBe('Clarify the request'))
  })

  it('opens real insertion choices from the task toolbar', async () => {
    const user = userEvent.setup()
    const { getNodeData } = renderPanel()
    await user.click(task())
    await user.click(screen.getByRole('button', { name: 'workflowAgent.nodes.agent.task.insert' }))
    expect(await screen.findByText('question')).toBeVisible()
    await user.click(screen.getByText('question'))
    await waitFor(() => expect(getNodeData().agent_task).toContain('{{#source.question#}}'))
  })

  it.each([true, false])(
    'edits a real output token with an existing declaration: %s',
    async (declared) => {
      const user = userEvent.setup()
      const { getNodeData } = renderPanel(
        createData({
          agent_task: 'Generate [§output:summary:summary§]',
          agent_declared_outputs: declared ? [summary] : [],
        }),
      )
      await user.click(
        await within(task()).findByRole('button', { name: new RegExp(`${outputPrefix}.edit`) }),
      )
      const form = outputForm()
      expect(form.getByRole('textbox', { name: `${outputPrefix}.nameLabel` })).toHaveValue(
        'summary',
      )
      await user.clear(form.getByRole('textbox', { name: `${outputPrefix}.nameLabel` }))
      await user.type(form.getByRole('textbox', { name: `${outputPrefix}.nameLabel` }), 'report')
      await user.click(form.getByRole('button', { name: `${outputPrefix}.confirm` }))
      await waitFor(() =>
        expect(getNodeData().agent_task).toBe('Generate [§output:report:report§]'),
      )
      expect(getNodeData().agent_declared_outputs).toEqual([
        expect.objectContaining({ name: 'report', type: 'string' }),
      ])
      expect(within(task()).getByText('report')).toBeVisible()
      expect(
        screen.getByRole('button', { name: 'workflow.nodes.common.outputVars' }),
      ).toHaveAttribute('aria-expanded', 'true')
    },
  )

  it('removes the declaration when its token is deleted from the task', async () => {
    const { getNodeData } = renderPanel(
      createData({
        agent_task: 'Generate [§output:summary:summary§]',
        agent_declared_outputs: [summary],
      }),
    )
    await replacePromptEditorText(task(), 'Generate a report')
    await waitFor(() => expect(getNodeData().agent_declared_outputs).toEqual([]))
    expect(getNodeData().agent_task).toBe('Generate a report')
  })

  it('preserves the prompt token when its declaration is deleted from the output list', async () => {
    const user = userEvent.setup()
    const prompt = 'Generate [§output:summary:summary§]'
    const { getNodeData } = renderPanel(
      createData({ agent_task: prompt, agent_declared_outputs: [summary] }),
    )
    const outputs = await openOutputs(user)
    await user.click(outputs.getByRole('button', { name: new RegExp(`${outputPrefix}.delete`) }))
    await waitFor(() => expect(getNodeData().agent_declared_outputs).toEqual([]))
    expect(getNodeData().agent_task).toBe(prompt)
    expect(within(task()).getByText('summary')).toBeVisible()
  })

  it('renames a referenced token when its declaration is renamed from the list', async () => {
    const user = userEvent.setup()
    const { getNodeData } = renderPanel(
      createData({
        agent_task: 'Generate [§output:summary:summary§]',
        agent_declared_outputs: [summary],
      }),
    )
    const outputs = await openOutputs(user)
    await user.click(outputs.getByRole('button', { name: new RegExp(`${outputPrefix}.edit`) }))
    const form = outputForm()
    await user.clear(form.getByRole('textbox', { name: `${outputPrefix}.nameLabel` }))
    await user.type(form.getByRole('textbox', { name: `${outputPrefix}.nameLabel` }), 'report')
    await user.click(form.getByRole('button', { name: `${outputPrefix}.confirm` }))
    await waitFor(() => expect(getNodeData().agent_task).toBe('Generate [§output:report:report§]'))
    expect(getNodeData().agent_declared_outputs).toEqual([{ ...summary, name: 'report' }])
  })

  it('adds an output without losing the latest task edit', async () => {
    const user = userEvent.setup()
    const { getNodeData, syncDraft } = renderPanel()
    await user.click(task())
    await user.paste('Latest task')
    await openOutputs(user)
    await user.click(screen.getByRole('button', { name: `${outputPrefix}.newOutput` }))
    const form = outputForm()
    await user.type(form.getByRole('textbox', { name: `${outputPrefix}.nameLabel` }), 'summary')
    await user.type(
      form.getByRole('textbox', { name: `${outputPrefix}.descriptionLabel` }),
      'Short summary',
    )
    await user.click(form.getByRole('button', { name: `${outputPrefix}.confirm` }))
    await waitFor(() => expect(getNodeData().agent_declared_outputs).toEqual([summary]))
    expect(getNodeData().agent_task).toBe('Latest task')
    expect(syncDraft).toHaveBeenCalled()
  })
})
