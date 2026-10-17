import type { ReactElement } from 'react'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import GetAutomaticRes from '../get-automatic-res'

const mockGenerateBasicAppFirstTimeRule = vi.fn()
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
      input: { body: { type: 'prompt' } },
    }).queryKey,
    mockInstructionTemplate ?? { data: '' },
  )
  return renderWithConsoleQuery(<EventEmitterContextProvider>{ui}</EventEmitterContextProvider>, {
    queryClient,
  })
}
const instruction = () => screen.getByRole('textbox', { name: /instruction/ })

vi.mock('@/service/debug', () => ({
  generateBasicAppFirstTimeRule: (...args: unknown[]) => mockGenerateBasicAppFirstTimeRule(...args),
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
        <button onClick={() => onCompletionParamsChange({ temperature: 0.3 })}>
          change-params
        </button>
      </div>
    ),
  }),
)

describe('GetAutomaticRes', () => {
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
      expect(instruction()).toHaveValue(
        'appGeneration.generate.template.pythonDebugger.instruction',
      )
    })

    await user.click(screen.getByText('change-model'))
    expect(localStorage.getItem('auto-gen-model')).toContain('"name":"gpt-4o-mini"')

    await user.click(screen.getByText('change-params'))
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
      expect(instruction()).toHaveValue('template instruction')
    })
    await user.clear(instruction())
    await user.click(screen.getByText(/(?:^|\.)generate\.generate(?=$|:)/))

    expect(instruction()).toHaveValue('')
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

    await user.type(instruction(), 'basic instruction')
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

    await user.type(instruction(), 'workflow instruction')
    await user.click(screen.getByRole('button', { name: /generate.idealOutput/ }))
    await user.type(screen.getByRole('textbox', { name: /generate.idealOutput/ }), 'ideal output')
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
