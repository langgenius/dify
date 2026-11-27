import type { DecisionNodeType } from '../types'
import type { Node } from '@/app/components/workflow/types'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useNodes } from 'reactflow'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import { initialNodes } from '@/app/components/workflow/utils/workflow-init'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import Panel from '../panel'
import { DecideBy } from '../types'

const generateDecision = vi.hoisted(() => vi.fn())
// boundary: the model catalog is external; tests control the default model here
const modelCatalog = vi.hoisted(() => ({
  defaultModel: null as {
    model: string
    model_type: string
    provider: { provider: string }
  } | null,
}))
modelCatalog.defaultModel = {
  model: 'gpt-4o-mini',
  model_type: 'llm',
  provider: { provider: 'openai' },
}

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModelAndCurrentProviderAndModel: () => ({
    defaultModel: modelCatalog.defaultModel,
  }),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'decisionGenerate.post': (input) => generateDecision(input),
    }),
  }
})

const createPanelData = (overrides: Partial<DecisionNodeType> = {}): DecisionNodeType => ({
  title: 'Decision',
  desc: '',
  type: BlockEnum.Decision,
  intent: 'Refund or not',
  decide_by: DecideBy.rules,
  outcomes: [{ id: 'outcome-1', label: '', when: { logical_operator: 'and', conditions: [] } }],
  otherwise: { label: '' },
  inputs: [],
  context: { glossary: '', prompt: '' },
  extras: [],
  ...overrides,
})

const createDownstreamNode = () =>
  createNode({
    id: 'downstream',
    data: {
      type: BlockEnum.Code,
      title: 'Code',
      desc: '',
      code_language: 'python3',
      code: '',
      outputs: {},
      variables: [{ variable: 'input', value_selector: ['node', 'note'] }],
    },
  })

const panelProps = {
  getInputVars: () => [],
  toVarInputs: () => [],
  runInputData: {},
  runInputDataRef: { current: {} },
  setRunInputData: () => {},
  runResult: null,
}

function LivePanel() {
  const nodes = useNodes<Node>()
  const node = nodes.find((item) => item.id === 'node')
  if (!node) return null
  const downstreamVars = (
    nodes.find((item) => item.id === 'downstream')?.data as
      | { variables?: { value_selector: string[] }[] }
      | undefined
  )?.variables
  return (
    <>
      <Panel id={node.id} data={node.data as unknown as DecisionNodeType} panelProps={panelProps} />
      <output aria-label="Decision extras">
        {JSON.stringify((node.data as unknown as DecisionNodeType).extras)}
      </output>
      <output aria-label="Downstream selector">
        {JSON.stringify(downstreamVars?.[0]?.value_selector)}
      </output>
    </>
  )
}

const renderPanel = (data: DecisionNodeType, options: { downstream?: boolean } = {}) => {
  const { queryClient } = createConsoleQueryWrapper()
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  return renderWorkflowFlowComponent(<LivePanel />, {
    queryClient,
    nodes: [
      createNode({ id: 'node', data }),
      ...(options.downstream ? [createDownstreamNode()] : []),
    ],
    edges: options.downstream
      ? [createEdge({ source: 'node', target: 'downstream', sourceHandle: 'otherwise' })]
      : [],
  })
}

const readExtras = (): DecisionNodeType['extras'] =>
  JSON.parse(screen.getByRole('status', { name: 'Decision extras' }).textContent!)
const readDownstreamSelector = (): string[] =>
  JSON.parse(screen.getByRole('status', { name: 'Downstream selector' }).textContent!)

describe('decision panel', () => {
  beforeEach(() => {
    generateDecision.mockReset()
    modelCatalog.defaultModel = {
      model: 'gpt-4o-mini',
      model_type: 'llm',
      provider: { provider: 'openai' },
    }
  })

  it('renders one generate entry as a real form submit and no secondary fill-in action', async () => {
    const user = userEvent.setup()
    generateDecision.mockResolvedValueOnce({
      decide_by: 'rules',
      outcomes: [],
      otherwise: { label: '' },
      inputs: [],
      extras: [],
      error: '',
    })
    renderPanel(createPanelData())

    // the removed secondary action must not come back
    expect(
      screen.queryByRole('button', { name: 'workflow.nodes.decision.fillInWithAI' }),
    ).not.toBeInTheDocument()

    const form = screen.getByRole('form', { name: 'workflow.nodes.decision.intent' })
    const sentence = within(form).getByRole('textbox', {
      name: 'workflow.nodes.decision.intent',
    })
    const generate = within(form).getByRole('button', {
      name: 'workflow.nodes.decision.generate',
    })
    expect(generate).toHaveAttribute('type', 'submit')
    expect(generate).not.toBeDisabled()

    await user.click(generate)
    expect(generateDecision).toHaveBeenCalledTimes(1)
    expect(generateDecision).toHaveBeenCalledWith({
      body: expect.objectContaining({ instruction: 'Refund or not' }),
    })
    expect(sentence).toBeInTheDocument()
  })

  it('disables the decided-by control while a generate request is pending', async () => {
    const user = userEvent.setup()
    generateDecision.mockImplementationOnce(() => new Promise(() => {}))
    renderPanel(createPanelData())

    const rulesMode = screen.getByRole('radio', { name: 'workflow.nodes.decision.decideBy.rules' })
    expect(rulesMode).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'workflow.nodes.decision.generate' }))

    expect(rulesMode).toBeDisabled()
    expect(
      screen.getByRole('radio', { name: 'workflow.nodes.decision.decideBy.llm' }),
    ).toBeDisabled()
  })

  it('announces a missing generation model as an alert linked to the sentence', async () => {
    const user = userEvent.setup()
    modelCatalog.defaultModel = null
    renderPanel(createPanelData())

    await user.click(screen.getByRole('button', { name: 'workflow.nodes.decision.generate' }))

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('workflow.nodes.decision.noModelToGenerate')
    const sentence = screen.getByRole('textbox', { name: 'workflow.nodes.decision.intent' })
    expect(sentence.getAttribute('aria-describedby')).toBe(alert.id)
  })

  it('announces a failed generation as an alert linked to the sentence', async () => {
    const user = userEvent.setup()
    generateDecision.mockResolvedValueOnce({
      decide_by: 'rules',
      outcomes: [],
      otherwise: { label: '' },
      inputs: [],
      extras: [],
      error: 'Model refused',
    })
    renderPanel(createPanelData())

    await user.click(screen.getByRole('button', { name: 'workflow.nodes.decision.generate' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Model refused')
    const sentence = screen.getByRole('textbox', { name: 'workflow.nodes.decision.intent' })
    expect(sentence.getAttribute('aria-describedby')).toBe(alert.id)
  })

  it('associates an extra-name error with its input', () => {
    renderPanel(
      createPanelData({ extras: [{ name: '1bad', from: 'fixed', values: {}, hint: '' }] }),
    )

    const nameInput = screen.getByRole('textbox', {
      name: 'workflow.nodes.decision.extraNameLabel',
    })
    expect(nameInput).toHaveAttribute('aria-invalid', 'true')
    const describedBy = nameInput.getAttribute('aria-describedby')!
    expect(describedBy).toBeTruthy()

    const error = document.getElementById(describedBy)
    expect(error).toHaveTextContent('workflow.nodes.decision.extraNameErrorInvalid')
  })

  it('commits an extra name on blur and keeps the committed identity while typing', async () => {
    const user = userEvent.setup()
    renderPanel(
      createPanelData({ extras: [{ name: 'note', from: 'fixed', values: {}, hint: '' }] }),
      { downstream: true },
    )

    const nameInput = screen.getByRole('textbox', {
      name: 'workflow.nodes.decision.extraNameLabel',
    })
    await user.clear(nameInput)
    await user.type(nameInput, 'new_note')

    // the intermediate empty draft never reaches node data
    expect(readExtras()[0]!.name).toBe('note')
    expect(readDownstreamSelector()).toEqual(['node', 'note'])

    await user.tab()

    expect(readExtras()[0]!.name).toBe('new_note')
    expect(readDownstreamSelector()).toEqual(['node', 'new_note'])
  })

  it('commits an extra name on Enter', async () => {
    const user = userEvent.setup()
    renderPanel(
      createPanelData({ extras: [{ name: 'note', from: 'fixed', values: {}, hint: '' }] }),
    )

    const nameInput = screen.getByRole('textbox', {
      name: 'workflow.nodes.decision.extraNameLabel',
    })
    await user.clear(nameInput)
    await user.type(nameInput, 'new_note{Enter}')

    expect(readExtras()[0]!.name).toBe('new_note')
  })

  it('keeps the committed name and shows the inline error when a commit is invalid', async () => {
    const user = userEvent.setup()
    renderPanel(
      createPanelData({ extras: [{ name: 'note', from: 'fixed', values: {}, hint: '' }] }),
    )

    const nameInput = screen.getByRole('textbox', {
      name: 'workflow.nodes.decision.extraNameLabel',
    })
    await user.clear(nameInput)
    await user.type(nameInput, 'outcome')
    await user.tab()

    expect(readExtras()[0]!.name).toBe('note')
    expect(nameInput).toHaveAttribute('aria-invalid', 'true')
    const error = document.getElementById(nameInput.getAttribute('aria-describedby')!)
    expect(error).toHaveTextContent('workflow.nodes.decision.extraNameErrorReserved')
  })

  it('opens a node loaded from a trimmed DSL with the backend defaults', () => {
    // The backend accepts node data without `otherwise`, `inputs`, `context`
    // or `extras` and stores the graph as written.
    const [loaded] = initialNodes(
      [
        createNode({
          id: 'node',
          data: {
            type: BlockEnum.Decision,
            title: 'Decision',
            desc: '',
            decide_by: DecideBy.rules,
            outcomes: [{ id: 'refund', label: 'Refund', when: { logical_operator: 'and' } }],
          },
        }),
      ],
      [],
    )
    renderPanel(loaded!.data as unknown as DecisionNodeType)

    expect(screen.getByRole('textbox', { name: 'workflow.nodes.decision.intent' })).toHaveValue('')
    expect(
      screen.getByRole('textbox', { name: 'workflow.nodes.decision.otherwiseLabel' }),
    ).toHaveValue('')
    expect(readExtras()).toEqual([])
  })
})
