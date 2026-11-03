import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { replacePromptEditorText } from '@/app/components/base/prompt-editor/plugins/__tests__/test-helpers'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
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
import GetCodeGeneratorResModal from '../get-code-generator-res'

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
      input: { body: { type: 'code' } },
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
  generateRule: (...args: unknown[]) => mockGenerateRule(...args),
}))

describe('GetCodeGeneratorResModal', () => {
  const mockOnClose = vi.fn()
  const mockOnFinished = vi.fn()

  beforeEach(() => {
    vi.resetAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    mockInstructionTemplate = undefined
  })

  it('should initialize from template suggestions and persist model updates', async () => {
    const user = userEvent.setup()
    mockInstructionTemplate = { data: 'code template' }

    render(
      <GetCodeGeneratorResModal
        flowId="flow-1"
        nodeId="node-1"
        currentCode="print(1)"
        modelMode="chat"
        isShow
        codeLanguages={CodeLanguage.python3}
        onClose={mockOnClose}
        onFinished={mockOnFinished}
      />,
    )

    await waitFor(() => {
      expect(instruction()).toHaveTextContent('code template')
    })

    await user.click(screen.getByRole('button', { name: /^gpt-4.1-mini/ }))
    await user.click(
      within(
        await screen.findByRole('dialog', { name: 'plugin.detailPanel.configureModel' }),
      ).getByRole('button', { name: /^gpt-4o-mini/ }),
    )
    expect(localStorage.getItem('auto-gen-model')).toContain('"name":"gpt-4o-mini"')

    await user.click(screen.getByRole('button', { name: /modelProvider.modelSettings/ }))
    await user.clear(screen.getByRole('spinbutton', { name: 'Temperature' }))
    await user.type(screen.getByRole('spinbutton', { name: 'Temperature' }), '0.2')
    await user.tab()
    expect(localStorage.getItem('auto-gen-model')).toContain('"temperature":0.2')
  })

  it('should preserve an intentionally cleared template instruction', async () => {
    const user = userEvent.setup()
    mockInstructionTemplate = { data: 'code template' }

    render(
      <GetCodeGeneratorResModal
        flowId="flow-1"
        nodeId="node-1"
        currentCode="print(1)"
        modelMode="chat"
        isShow
        codeLanguages={CodeLanguage.python3}
        onClose={mockOnClose}
        onFinished={mockOnFinished}
      />,
    )

    await waitFor(() => {
      expect(instruction()).toHaveTextContent('code template')
    })
    await replacePromptEditorText(instruction(), '')
    await user.click(screen.getByText(/(?:^|\.)codegen\.generate(?=$|:)/))

    expect(instruction().textContent).toBe('')
    expect(mockToastError).toHaveBeenCalledWith(
      expect.stringMatching(/(?:^|\.)errorMsg\.fieldRequired(?=$|:)/),
    )
    expect(mockGenerateRule).not.toHaveBeenCalled()
  })

  it('should generate code, normalize code payloads, and apply the confirmed result', async () => {
    const user = userEvent.setup()
    mockGenerateRule.mockResolvedValue({
      code: 'print("hello")',
    })

    render(
      <GetCodeGeneratorResModal
        flowId="flow-1"
        nodeId="node-1"
        currentCode="print(1)"
        modelMode="completion"
        isShow
        codeLanguages={CodeLanguage.python3}
        onClose={mockOnClose}
        onFinished={mockOnFinished}
      />,
    )

    await user.click(instruction())
    await user.paste('code instruction')
    await user.click(screen.getByRole('button', { name: /generate.idealOutput/ }))
    await user.click(screen.getByRole('textbox', { name: /generate.idealOutput/ }))
    await user.paste('code output')
    await user.click(screen.getByText(/(?:^|\.)codegen\.generate(?=$|:)/))

    await waitFor(() => {
      expect(mockGenerateRule).toHaveBeenCalledWith(
        expect.objectContaining({
          flow_id: 'flow-1',
          node_id: 'node-1',
          current: 'print(1)',
          instruction: 'code instruction',
          ideal_output: 'code output',
          language: 'python',
          model_config: expect.objectContaining({ mode: 'completion' }),
        }),
      )
    })

    await waitFor(() => {
      expect(screen.getByTestId('monaco-editor')).toHaveValue('print("hello")')
    })

    await user.click(screen.getByRole('button', { name: /(?:^|\.)generate\.apply(?=$|:)/ }))

    await waitFor(() => {
      expect(screen.getByText(/(?:^|\.)codegen\.overwriteConfirmTitle(?=$|:)/)).toBeInTheDocument()
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
        modified: 'print("hello")',
        code: 'print("hello")',
      }),
    )
  })

  it('should surface service errors without creating a result version', async () => {
    const user = userEvent.setup()
    mockGenerateRule.mockResolvedValue({
      error: 'generation failed',
      modified: 'unused',
    })

    render(
      <GetCodeGeneratorResModal
        flowId="flow-1"
        nodeId="node-1"
        currentCode="print(1)"
        modelMode="chat"
        isShow
        codeLanguages={CodeLanguage.javascript}
        onClose={mockOnClose}
        onFinished={mockOnFinished}
      />,
    )

    await user.click(instruction())
    await user.paste('code instruction')
    await user.click(screen.getByText(/(?:^|\.)codegen\.generate(?=$|:)/))

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('generation failed')
    })

    expect(screen.queryByTestId('monaco-editor')).not.toBeInTheDocument()
  })
})
