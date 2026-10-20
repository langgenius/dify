import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { replacePromptEditorText } from '@/app/components/base/prompt-editor/plugins/__tests__/test-helpers'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { consoleQuery } from '@/service/console'
import {
  createCatalogModelFixture,
  createDefaultModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryWrapper, seedAppDslVersion } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import GetAutomaticRes from '../get-automatic-res'

const mockGenerateBasicAppFirstTimeRule = vi.fn()
const mockGenerateRule = vi.fn()
const mockToastError = vi.fn()

let mockInstructionTemplate: { data: string } | undefined
vi.mock('@/app/components/app/configuration/toast', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

const render = createNuqsTestRenderer((ui) => {
  const { queryClient } = createConsoleQueryWrapper()
  seedAppDslVersion(queryClient)
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  seedModelProviderQueries(queryClient, [
    createModelCatalogFixture({
      models: ['gpt-4.1-mini', 'gpt-4o-mini'].map((model) =>
        createCatalogModelFixture({
          model,
          label: { en_US: model },
          model_properties: { mode: 'chat' },
        }),
      ),
    }),
  ])
  queryClient.setQueryData(
    consoleQuery.workspaces.current.defaultModel.get.queryKey({
      input: { query: { model_type: 'llm' } },
    }),
    { data: createDefaultModelFixture({ model: 'gpt-4.1-mini' }) },
  )
  queryClient.setQueryDefaults(
    consoleQuery.workspaces.current.modelProviders.byProvider.models.parameterRules.get.key(),
    {
      initialData: {
        data: [
          {
            name: 'temperature',
            label: { en_US: 'Temperature' },
            type: 'float',
            default: 0.7,
            min: 0,
            max: 2,
          },
        ],
      },
    },
  )
  queryClient.setQueryData(
    consoleQuery.instructionGenerate.template.post.queryOptions({
      input: { body: { type: 'prompt' } },
    }).queryKey,
    mockInstructionTemplate ?? { data: '' },
  )
  return renderWorkflowFlowComponent(
    <EventEmitterContextProvider>{ui}</EventEmitterContextProvider>,
    {
      queryClient,
    },
  )
})
const instruction = () => screen.getByRole('textbox', { name: /instruction/ })

vi.mock('@/service/debug', () => ({
  generateBasicAppFirstTimeRule: (...args: unknown[]) => mockGenerateBasicAppFirstTimeRule(...args),
  generateRule: (...args: unknown[]) => mockGenerateRule(...args),
}))

describe('GetAutomaticRes', () => {
  const mockOnClose = vi.fn()
  const mockOnFinished = vi.fn()

  beforeEach(() => {
    vi.resetAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    mockInstructionTemplate = undefined
  })

  it('should apply a basic suggestion and persist model updates', async () => {
    const user = userEvent.setup()
    render(
      <GetAutomaticRes
        modelMode="chat"
        isShow
        onClose={mockOnClose}
        onFinished={mockOnFinished}
        flowId="flow-1"
        isBasicMode
      />,
    )

    expect(screen.getByRole('dialog', { name: /generate\.title/ })).toBeInTheDocument()

    await user.click(screen.getByText(/(?:^|\.)generate\.template\.pythonDebugger\.name(?=$|:)/))

    await waitFor(() => {
      expect(instruction()).toHaveTextContent(
        'appGeneration.generate.template.pythonDebugger.instruction',
      )
    })

    await user.click(screen.getByRole('button', { name: /^gpt-4.1-mini/ }))
    await user.click(
      within(
        await screen.findByRole('dialog', { name: 'plugin.detailPanel.configureModel' }),
      ).getByRole('button', { name: /^gpt-4o-mini/ }),
    )
    expect(localStorage.getItem('auto-gen-model')).toContain('"name":"gpt-4o-mini"')

    await user.click(screen.getByRole('button', { name: /modelProvider.modelSettings/ }))
    await user.click(screen.getByRole('switch', { name: 'Temperature' }))
    await user.clear(screen.getByRole('spinbutton', { name: 'Temperature' }))
    await user.type(screen.getByRole('spinbutton', { name: 'Temperature' }), '0.3')
    await user.tab()
    expect(localStorage.getItem('auto-gen-model')).toContain('"temperature":0.3')
  })

  it('should preserve an intentionally cleared template instruction', async () => {
    const user = userEvent.setup()
    mockInstructionTemplate = { data: 'template instruction' }

    render(
      <GetAutomaticRes
        modelMode="chat"
        isShow
        onClose={mockOnClose}
        onFinished={mockOnFinished}
        flowId="flow-1"
      />,
    )

    await waitFor(() => {
      expect(instruction()).toHaveTextContent('template instruction')
    })
    await replacePromptEditorText(instruction(), '')
    await user.click(screen.getByText(/(?:^|\.)generate\.generate(?=$|:)/))

    expect(instruction().textContent).toBe('')
    expect(mockToastError).toHaveBeenCalledWith(
      expect.stringMatching(/(?:^|\.)errorMsg\.fieldRequired(?=$|:)/),
    )
    expect(mockGenerateRule).not.toHaveBeenCalled()
  })

  it('should block generation when instruction is empty', async () => {
    const user = userEvent.setup()
    render(
      <GetAutomaticRes
        modelMode="chat"
        isShow
        onClose={mockOnClose}
        onFinished={mockOnFinished}
        flowId="flow-1"
        isBasicMode
      />,
    )

    await user.click(screen.getByText(/(?:^|\.)generate\.generate(?=$|:)/))

    expect(mockToastError).toHaveBeenCalledWith(
      expect.stringMatching(/(?:^|\.)errorMsg\.fieldRequired(?=$|:)/),
    )
    expect(mockGenerateBasicAppFirstTimeRule).not.toHaveBeenCalled()
    expect(screen.getByText(/generate.newNoDataLine1/)).toBeInTheDocument()
  })

  it('should generate a basic prompt and apply the confirmed result', async () => {
    const user = userEvent.setup()
    mockGenerateBasicAppFirstTimeRule.mockResolvedValue({
      prompt: 'generated prompt',
      variables: ['city'],
      opening_statement: 'hello there',
    })

    render(
      <GetAutomaticRes
        modelMode="chat"
        isShow
        onClose={mockOnClose}
        onFinished={mockOnFinished}
        flowId="flow-1"
        isBasicMode
      />,
    )

    await user.click(instruction())
    await user.paste('basic instruction')
    await user.click(screen.getByText(/(?:^|\.)generate\.generate(?=$|:)/))

    await waitFor(() => {
      expect(mockGenerateBasicAppFirstTimeRule).toHaveBeenCalledWith(
        expect.objectContaining({
          instruction: 'basic instruction',
          no_variable: false,
        }),
      )
    })

    await waitFor(() => {
      expect(screen.getByText('generated prompt')).toHaveTextContent('generated prompt')
    })

    await user.click(screen.getByRole('button', { name: /(?:^|\.)generate\.apply(?=$|:)/ }))

    await waitFor(() => {
      expect(screen.getByText(/(?:^|\.)generate\.overwriteTitle(?=$|:)/)).toBeInTheDocument()
    })

    const confirmation = screen.getByRole('alertdialog')
    expect(mockOnFinished).not.toHaveBeenCalled()
    await user.click(within(confirmation).getByRole('button', { name: /operation\.cancel/ }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(mockOnFinished).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /generate\.apply/ }))
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: /operation\.confirm/,
      }),
    )

    expect(mockOnFinished).toHaveBeenCalledWith(
      expect.objectContaining({
        modified: 'generated prompt',
        variables: ['city'],
        opening_statement: 'hello there',
      }),
    )
  })

  it('should request workflow generation and surface service errors', async () => {
    const user = userEvent.setup()
    mockGenerateRule.mockResolvedValue({
      error: 'generation failed',
      modified: 'unused',
    })

    render(
      <GetAutomaticRes
        modelMode="chat"
        isShow
        onClose={mockOnClose}
        onFinished={mockOnFinished}
        flowId="flow-1"
        nodeId="node-1"
        editorId="editor-1"
        currentPrompt="current prompt"
        isBasicMode={false}
      />,
    )

    await user.click(instruction())
    await user.paste('workflow instruction')
    await user.click(screen.getByRole('button', { name: /generate.idealOutput/ }))
    await user.click(screen.getByRole('textbox', { name: /generate.idealOutput/ }))
    await user.paste('ideal output')
    await user.click(screen.getByText(/(?:^|\.)generate\.generate(?=$|:)/))

    await waitFor(() => {
      expect(mockGenerateRule).toHaveBeenCalledWith(
        expect.objectContaining({
          flow_id: 'flow-1',
          node_id: 'node-1',
          current: 'current prompt',
          instruction: 'workflow instruction',
          ideal_output: 'ideal output',
          model_config: expect.objectContaining({ mode: 'chat' }),
        }),
      )
    })

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('generation failed')
    })

    expect(screen.getByText(/generate.newNoDataLine1/)).toBeInTheDocument()
  })
})
