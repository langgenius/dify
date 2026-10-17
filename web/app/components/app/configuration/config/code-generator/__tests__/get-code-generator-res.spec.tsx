import type { ReactElement } from 'react'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import GetCodeGeneratorResModal from '../get-code-generator-res'

const mockGenerateRule = vi.fn()
const mockToastError = vi.fn()

let mockDefaultModel: {
  model: string
  provider: {
    provider: string
  }
} | null = null

let mockInstructionTemplate: { data: string } | undefined
vi.mock('@/app/components/app/configuration/toast', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModelAndCurrentProviderAndModel: () => ({
    defaultModel: mockDefaultModel,
  }),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-available-var-list', () => ({
  default: () => ({ availableVars: [], availableNodes: [] }),
}))
vi.mock('@/app/components/workflow/hooks/use-workflow-variables', () => ({
  useWorkflowVariableType: () => () => 'string',
}))
vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({ getState: () => ({ nodesWithInspectVars: [] }) }),
}))

const render = (ui: ReactElement) => {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(
    consoleQuery.instructionGenerate.template.post.queryOptions({
      input: { body: { type: 'code' } },
    }).queryKey,
    mockInstructionTemplate ?? { data: '' },
  )
  return renderWithConsoleQuery(<EventEmitterContextProvider>{ui}</EventEmitterContextProvider>, {
    queryClient,
  })
}
const instruction = () => screen.getByRole('textbox', { name: /instruction/ })

vi.mock('@/service/debug', () => ({
  generateRule: (...args: unknown[]) => mockGenerateRule(...args),
}))

vi.mock(
  '@/app/components/header/account-setting/model-provider-page/model-parameter-modal',
  () => ({
    default: ({
      setModel,
      onCompletionParamsChange,
    }: {
      setModel: (value: {
        modelId: string
        provider: string
        mode?: string
        features?: string[]
      }) => void
      onCompletionParamsChange: (value: Record<string, unknown>) => void
    }) => (
      <div>
        <button
          onClick={() =>
            setModel({ modelId: 'gpt-4o-mini', provider: 'openai', mode: 'chat' as const })
          }
        >
          change-model
        </button>
        <button onClick={() => onCompletionParamsChange({ temperature: 0.2 })}>
          change-params
        </button>
      </div>
    ),
  }),
)

vi.mock(
  '@/app/components/workflow/nodes/llm/components/json-schema-config-modal/code-editor',
  () => ({
    default: ({ value }: { value: string }) => <div data-testid="code-result-panel">{value}</div>,
  }),
)

describe('GetCodeGeneratorResModal', () => {
  const mockOnClose = vi.fn()
  const mockOnFinished = vi.fn()

  beforeEach(() => {
    vi.resetAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    mockDefaultModel = {
      model: 'gpt-4.1-mini',
      provider: {
        provider: 'openai',
      },
    }
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
      expect(instruction()).toHaveValue('code template')
    })

    await user.click(screen.getByText('change-model'))
    expect(localStorage.getItem('auto-gen-model')).toContain('"name":"gpt-4o-mini"')

    await user.click(screen.getByText('change-params'))
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
      expect(instruction()).toHaveValue('code template')
    })
    await user.clear(instruction())
    await user.click(screen.getByText(/(?:^|\.)codegen\.generate(?=$|:)/))

    expect(instruction()).toHaveValue('')
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

    await user.type(instruction(), 'code instruction')
    await user.click(screen.getByRole('button', { name: /generate.idealOutput/ }))
    await user.type(screen.getByRole('textbox', { name: /generate.idealOutput/ }), 'code output')
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
      expect(screen.getByTestId('code-result-panel')).toHaveTextContent('print("hello")')
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

    await user.type(instruction(), 'code instruction')
    await user.click(screen.getByText(/(?:^|\.)codegen\.generate(?=$|:)/))

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('generation failed')
    })

    expect(screen.queryByTestId('code-result-panel')).not.toBeInTheDocument()
  })
})

// PromptEditor owns rich text behavior; this feature owns instruction persistence and generation.
vi.mock('@/app/components/base/prompt-editor', () => ({
  default: ({
    value,
    onChange,
    'aria-label': label,
    'aria-labelledby': labelledBy,
  }: import('@/app/components/base/prompt-editor').PromptEditorProps) => (
    <textarea
      aria-label={label}
      aria-labelledby={labelledBy}
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
}))
