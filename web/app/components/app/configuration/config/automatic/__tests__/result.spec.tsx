import { fireEvent, render, screen } from '@testing-library/react'
import { toast } from '@/app/components/base/ui/toast'
import Result from '../result'
import { GeneratorType } from '../types'

const mockCopy = vi.fn()
const mockPromptRes = vi.fn()
const mockPromptResInWorkflow = vi.fn()
const mockSetCurrentVersionIndex = vi.fn()
const mockOnApply = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('copy-to-clipboard', () => ({
  default: (...args: unknown[]) => mockCopy(...args),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    success: vi.fn(),
  },
}))

vi.mock('../prompt-res', () => ({
  default: (props: Record<string, unknown>) => {
    mockPromptRes(props)
    return <div data-testid="prompt-res">{String(props.value)}</div>
  },
}))

vi.mock('../prompt-res-in-workflow', () => ({
  default: (props: Record<string, unknown>) => {
    mockPromptResInWorkflow(props)
    return <div data-testid="prompt-res-in-workflow">{String(props.value)}</div>
  },
}))

vi.mock('@/app/components/workflow/nodes/llm/components/json-schema-config-modal/code-editor', () => ({
  default: ({ value }: { value: string }) => <div data-testid="code-editor">{value}</div>,
}))

vi.mock('../prompt-toast', () => ({
  default: ({ message }: { message: string }) => <div data-testid="prompt-toast">{message}</div>,
}))

vi.mock('../version-selector', () => ({
  default: ({ value, versionLen, onChange }: { value: number, versionLen: number, onChange: (index: number) => void }) => (
    <button data-testid="version-selector" onClick={() => onChange(versionLen - 1)}>
      version-
      {value}
    </button>
  ),
}))

const baseProps = {
  current: {
    modified: 'generated output',
    message: 'optimization note',
  },
  currentVersionIndex: 0,
  setCurrentVersionIndex: mockSetCurrentVersionIndex,
  versions: [{ modified: 'v1' }, { modified: 'v2' }],
  onApply: mockOnApply,
}

describe('Result', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the basic prompt result and support copying or applying it', () => {
    render(
      <Result
        {...baseProps}
        isBasicMode
        generatorType={GeneratorType.prompt}
      />,
    )

    expect(screen.getByTestId('prompt-toast'))!.toHaveTextContent('optimization note')
    expect(screen.getByTestId('prompt-res'))!.toHaveTextContent('generated output')

    fireEvent.click(screen.getByTestId('version-selector'))
    fireEvent.click(screen.getAllByRole('button')[1]!)
    fireEvent.click(screen.getByText('generate.apply'))

    expect(mockSetCurrentVersionIndex).toHaveBeenCalledWith(1)
    expect(mockCopy).toHaveBeenCalledWith('generated output')
    expect(toast.success).toHaveBeenCalledWith('actionMsg.copySuccessfully')
    expect(mockOnApply).toHaveBeenCalled()
    expect(mockPromptRes).toHaveBeenCalledWith(expect.objectContaining({
      workflowVariableBlock: { show: false },
    }))
  })

  it('should render workflow prompt results through PromptResInWorkflow when basic mode is disabled', () => {
    render(
      <Result
        {...baseProps}
        nodeId="node-1"
        generatorType={GeneratorType.prompt}
      />,
    )

    expect(screen.getByTestId('prompt-res-in-workflow'))!.toHaveTextContent('generated output')
    expect(mockPromptResInWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      nodeId: 'node-1',
      value: 'generated output',
    }))
  })

  it('should render code results with the code editor for non-prompt generators', () => {
    render(
      <Result
        {...baseProps}
        generatorType={GeneratorType.code}
      />,
    )

    expect(screen.getByTestId('code-editor'))!.toHaveTextContent('generated output')
  })
})
