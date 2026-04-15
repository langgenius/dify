import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { AppModeEnum } from '@/types/app'
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
      <button onClick={() => onCompletionParamsChange({ temperature: 0.2 })}>change-params</button>
    </div>
  ),
}))

vi.mock('../../automatic/instruction-editor-in-workflow', () => ({
  default: ({
    value,
    onChange,
  }: {
    value: string
    onChange: (value: string) => void
  }) => (
    <div>
      <div data-testid="workflow-editor">{value}</div>
      <button onClick={() => onChange('code instruction')}>set-code-instruction</button>
    </div>
  ),
}))

vi.mock('../../automatic/idea-output', () => ({
  default: ({
    value,
    onChange,
  }: {
    value: string
    onChange: (value: string) => void
  }) => (
    <div>
      <div data-testid="idea-output">{value}</div>
      <button onClick={() => onChange('code output')}>set-code-output</button>
    </div>
  ),
}))

vi.mock('../../automatic/res-placeholder', () => ({
  default: () => <div>code-result-placeholder</div>,
}))

vi.mock('../../automatic/result', () => ({
  default: ({
    current,
    onApply,
  }: {
    current: { modified?: string, code?: string }
    onApply: () => void
  }) => (
    <div data-testid="code-result-panel">
      <div>{current.modified || current.code}</div>
      <button onClick={onApply}>apply-code-result</button>
    </div>
  ),
}))

describe('GetCodeGeneratorResModal', () => {
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
    mockInstructionTemplate = { data: 'code template' }

    render(
      <GetCodeGeneratorResModal
        flowId="flow-1"
        nodeId="node-1"
        currentCode="print(1)"
        mode={AppModeEnum.CHAT}
        isShow
        codeLanguages={CodeLanguage.python3}
        onClose={mockOnClose}
        onFinished={mockOnFinished}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('workflow-editor')).toHaveTextContent('code template')
    })

    fireEvent.click(screen.getByText('change-model'))
    expect(localStorage.getItem('auto-gen-model')).toContain('"name":"gpt-4o-mini"')

    fireEvent.click(screen.getByText('change-params'))
    expect(localStorage.getItem('auto-gen-model')).toContain('"temperature":0.2')
  })

  it('should block generation when instruction is empty', () => {
    render(
      <GetCodeGeneratorResModal
        flowId="flow-1"
        nodeId="node-1"
        currentCode="print(1)"
        mode={AppModeEnum.CHAT}
        isShow
        codeLanguages={CodeLanguage.python3}
        onClose={mockOnClose}
        onFinished={mockOnFinished}
      />,
    )

    fireEvent.click(screen.getByText('codegen.generate'))

    expect(mockToastError).toHaveBeenCalledWith('errorMsg.fieldRequired')
    expect(mockGenerateRule).not.toHaveBeenCalled()
    expect(screen.getByText('code-result-placeholder')).toBeInTheDocument()
  })

  it('should generate code, normalize code payloads, and apply the confirmed result', async () => {
    mockGenerateRule.mockResolvedValue({
      code: 'print("hello")',
    })

    render(
      <GetCodeGeneratorResModal
        flowId="flow-1"
        nodeId="node-1"
        currentCode="print(1)"
        mode={AppModeEnum.CHAT}
        isShow
        codeLanguages={CodeLanguage.python3}
        onClose={mockOnClose}
        onFinished={mockOnFinished}
      />,
    )

    fireEvent.click(screen.getByText('set-code-instruction'))
    fireEvent.click(screen.getByText('set-code-output'))
    fireEvent.click(screen.getByText('codegen.generate'))

    await waitFor(() => {
      expect(mockGenerateRule).toHaveBeenCalledWith(expect.objectContaining({
        flow_id: 'flow-1',
        node_id: 'node-1',
        current: 'print(1)',
        instruction: 'code instruction',
        ideal_output: 'code output',
        language: 'python',
      }))
    })

    await waitFor(() => {
      expect(screen.getByTestId('code-result-panel')).toHaveTextContent('print("hello")')
    })

    fireEvent.click(screen.getByText('apply-code-result'))

    await waitFor(() => {
      expect(screen.getByText('codegen.overwriteConfirmTitle')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'operation.confirm' }))

    expect(mockOnFinished).toHaveBeenCalledWith(expect.objectContaining({
      modified: 'print("hello")',
      code: 'print("hello")',
    }))
  })

  it('should close overwrite confirmation without applying the generated code when cancelled', async () => {
    mockGenerateRule.mockResolvedValue({
      code: 'print("hello")',
    })

    render(
      <GetCodeGeneratorResModal
        flowId="flow-1"
        nodeId="node-1"
        currentCode="print(1)"
        mode={AppModeEnum.CHAT}
        isShow
        codeLanguages={CodeLanguage.python3}
        onClose={mockOnClose}
        onFinished={mockOnFinished}
      />,
    )

    fireEvent.click(screen.getByText('set-code-instruction'))
    fireEvent.click(screen.getByText('set-code-output'))
    fireEvent.click(screen.getByText('codegen.generate'))

    await waitFor(() => {
      expect(screen.getByTestId('code-result-panel')).toHaveTextContent('print("hello")')
    })

    fireEvent.click(screen.getByText('apply-code-result'))
    const dialog = await screen.findByRole('alertdialog')

    fireEvent.click(within(dialog).getByRole('button', { name: 'operation.cancel' }))

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    expect(mockOnFinished).not.toHaveBeenCalled()
  })

  it('should surface service errors without creating a result version', async () => {
    mockGenerateRule.mockResolvedValue({
      error: 'generation failed',
      modified: 'unused',
    })

    render(
      <GetCodeGeneratorResModal
        flowId="flow-1"
        nodeId="node-1"
        currentCode="print(1)"
        mode={AppModeEnum.CHAT}
        isShow
        codeLanguages={CodeLanguage.javascript}
        onClose={mockOnClose}
        onFinished={mockOnFinished}
      />,
    )

    fireEvent.click(screen.getByText('set-code-instruction'))
    fireEvent.click(screen.getByText('codegen.generate'))

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('generation failed')
    })

    expect(screen.queryByTestId('code-result-panel')).not.toBeInTheDocument()
  })
})
