import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { AppModeEnum } from '@/types/app'
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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModelAndCurrentProviderAndModel: () => ({
    defaultModel: mockDefaultModel,
  }),
}))

vi.mock('@/service/use-apps', () => ({
  useGenerateRuleTemplate: () => ({
    data: mockInstructionTemplate,
  }),
}))

vi.mock('@/service/debug', () => ({
  generateBasicAppFirstTimeRule: (...args: unknown[]) => mockGenerateBasicAppFirstTimeRule(...args),
  generateRule: (...args: unknown[]) => mockGenerateRule(...args),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-parameter-modal', () => ({
  default: ({
    setModel,
    onCompletionParamsChange,
  }: {
    setModel: (value: { modelId: string, provider: string, mode?: string, features?: string[] }) => void
    onCompletionParamsChange: (value: Record<string, unknown>) => void
  }) => (
    <div>
      <button onClick={() => setModel({ modelId: 'gpt-4o-mini', provider: 'openai', mode: 'chat' })}>change-model</button>
      <button onClick={() => onCompletionParamsChange({ temperature: 0.3 })}>change-params</button>
    </div>
  ),
}))

vi.mock('../instruction-editor', () => ({
  default: ({
    value,
    onChange,
  }: {
    value: string
    onChange: (value: string) => void
  }) => (
    <div>
      <div data-testid="basic-editor">{value}</div>
      <button onClick={() => onChange('basic instruction')}>set-basic-instruction</button>
    </div>
  ),
}))

vi.mock('../instruction-editor-in-workflow', () => ({
  default: ({
    value,
    onChange,
  }: {
    value: string
    onChange: (value: string) => void
  }) => (
    <div>
      <div data-testid="workflow-editor">{value}</div>
      <button onClick={() => onChange('workflow instruction')}>set-workflow-instruction</button>
    </div>
  ),
}))

vi.mock('../idea-output', () => ({
  default: ({
    value,
    onChange,
  }: {
    value: string
    onChange: (value: string) => void
  }) => (
    <div>
      <div data-testid="idea-output">{value}</div>
      <button onClick={() => onChange('ideal output')}>set-idea-output</button>
    </div>
  ),
}))

vi.mock('../res-placeholder', () => ({
  default: () => <div>result-placeholder</div>,
}))

vi.mock('../result', () => ({
  default: ({
    current,
    onApply,
  }: {
    current: { modified?: string, prompt?: string }
    onApply: () => void
  }) => (
    <div data-testid="result-panel">
      <div>{current.modified || current.prompt}</div>
      <button onClick={onApply}>apply-result</button>
    </div>
  ),
}))

describe('GetAutomaticRes', () => {
  const mockOnClose = vi.fn()
  const mockOnFinished = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
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
    mockInstructionTemplate = { data: 'template instruction' }

    render(
      <GetAutomaticRes
        mode={AppModeEnum.CHAT}
        isShow
        onClose={mockOnClose}
        onFinished={mockOnFinished}
        flowId="flow-1"
        isBasicMode
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('basic-editor')).toHaveTextContent('template instruction')
    })

    fireEvent.click(screen.getByText('generate.template.pythonDebugger.name'))

    await waitFor(() => {
      expect(screen.getByTestId('basic-editor')).toHaveTextContent('generate.template.pythonDebugger.instruction')
    })

    fireEvent.click(screen.getByText('change-model'))
    expect(localStorage.getItem('auto-gen-model')).toContain('"name":"gpt-4o-mini"')

    fireEvent.click(screen.getByText('change-params'))
    expect(localStorage.getItem('auto-gen-model')).toContain('"temperature":0.3')
  })

  it('should block generation when instruction is empty', () => {
    render(
      <GetAutomaticRes
        mode={AppModeEnum.CHAT}
        isShow
        onClose={mockOnClose}
        onFinished={mockOnFinished}
        flowId="flow-1"
        isBasicMode
      />,
    )

    fireEvent.click(screen.getByText('generate.generate'))

    expect(mockToastError).toHaveBeenCalledWith('errorMsg.fieldRequired')
    expect(mockGenerateBasicAppFirstTimeRule).not.toHaveBeenCalled()
    expect(screen.getByText('result-placeholder')).toBeInTheDocument()
  })

  it('should generate a basic prompt and apply the confirmed result', async () => {
    mockGenerateBasicAppFirstTimeRule.mockResolvedValue({
      prompt: 'generated prompt',
      variables: ['city'],
      opening_statement: 'hello there',
    })

    render(
      <GetAutomaticRes
        mode={AppModeEnum.CHAT}
        isShow
        onClose={mockOnClose}
        onFinished={mockOnFinished}
        flowId="flow-1"
        isBasicMode
      />,
    )

    fireEvent.click(screen.getByText('set-basic-instruction'))
    fireEvent.click(screen.getByText('generate.generate'))

    await waitFor(() => {
      expect(mockGenerateBasicAppFirstTimeRule).toHaveBeenCalledWith(expect.objectContaining({
        instruction: 'basic instruction',
        no_variable: false,
      }))
    })

    await waitFor(() => {
      expect(screen.getByTestId('result-panel')).toHaveTextContent('generated prompt')
    })

    fireEvent.click(screen.getByText('apply-result'))

    await waitFor(() => {
      expect(screen.getByText('generate.overwriteTitle')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'operation.confirm' }))

    expect(mockOnFinished).toHaveBeenCalledWith(expect.objectContaining({
      modified: 'generated prompt',
      variables: ['city'],
      opening_statement: 'hello there',
    }))
  })

  it('should close overwrite confirmation without applying the generated result when cancelled', async () => {
    mockGenerateBasicAppFirstTimeRule.mockResolvedValue({
      prompt: 'generated prompt',
      variables: ['city'],
      opening_statement: 'hello there',
    })

    render(
      <GetAutomaticRes
        mode={AppModeEnum.CHAT}
        isShow
        onClose={mockOnClose}
        onFinished={mockOnFinished}
        flowId="flow-1"
        isBasicMode
      />,
    )

    fireEvent.click(screen.getByText('set-basic-instruction'))
    fireEvent.click(screen.getByText('generate.generate'))

    await waitFor(() => {
      expect(screen.getByTestId('result-panel')).toHaveTextContent('generated prompt')
    })

    fireEvent.click(screen.getByText('apply-result'))
    const dialog = await screen.findByRole('alertdialog')

    fireEvent.click(within(dialog).getByRole('button', { name: 'operation.cancel' }))

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    expect(mockOnFinished).not.toHaveBeenCalled()
  })

  it('should request workflow generation and surface service errors', async () => {
    mockGenerateRule.mockResolvedValue({
      error: 'generation failed',
      modified: 'unused',
    })

    render(
      <GetAutomaticRes
        mode={AppModeEnum.ADVANCED_CHAT}
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

    fireEvent.click(screen.getByText('set-workflow-instruction'))
    fireEvent.click(screen.getByText('set-idea-output'))
    fireEvent.click(screen.getByText('generate.generate'))

    await waitFor(() => {
      expect(mockGenerateRule).toHaveBeenCalledWith(expect.objectContaining({
        flow_id: 'flow-1',
        node_id: 'node-1',
        current: 'current prompt',
        instruction: 'workflow instruction',
        ideal_output: 'ideal output',
      }))
    })

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('generation failed')
    })

    expect(screen.queryByTestId('result-panel')).not.toBeInTheDocument()
  })
})
