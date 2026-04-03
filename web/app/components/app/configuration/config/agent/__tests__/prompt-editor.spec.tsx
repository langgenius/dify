import { fireEvent, render, screen } from '@testing-library/react'
import ConfigContext from '@/context/debug-configuration'
import PromptEditor from '../prompt-editor'

const mockCopy = vi.fn()
const mockSetShowExternalDataToolModal = vi.fn()
const mockSetExternalDataToolsConfig = vi.fn()
const mockToastError = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('copy-to-clipboard', () => ({
  default: (...args: unknown[]) => mockCopy(...args),
}))

vi.mock('@/app/components/base/icons/src/vender/line/files', () => ({
  Copy: ({ onClick }: { onClick: () => void }) => (
    <button onClick={onClick}>copy-prompt</button>
  ),
  CopyCheck: () => <span>copied</span>,
}))

vi.mock('@/app/components/base/prompt-editor', () => ({
  default: (props: {
    onChange: (value: string) => void
    externalToolBlock: { onAddExternalTool: () => void }
  }) => (
    <div>
      <button onClick={() => props.onChange('updated prompt')}>change-prompt</button>
      <button onClick={props.externalToolBlock.onAddExternalTool}>open-tool-modal</button>
    </div>
  ),
}))

vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowExternalDataToolModal: mockSetShowExternalDataToolModal,
  }),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

const createContextValue = (overrides: Record<string, unknown> = {}) => ({
  modelConfig: {
    configs: {
      prompt_variables: [
        { key: 'existing_var', name: 'Existing' },
      ],
    },
  },
  hasSetBlockStatus: {
    context: false,
  },
  dataSets: [],
  showSelectDataSet: vi.fn(),
  externalDataToolsConfig: [],
  setExternalDataToolsConfig: mockSetExternalDataToolsConfig,
  ...overrides,
}) as any

describe('AgentPromptEditor', () => {
  const mockOnChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the correct title and forward prompt changes', () => {
    render(
      <ConfigContext.Provider value={createContextValue()}>
        <PromptEditor
          type="first-prompt"
          value="hello"
          onChange={mockOnChange}
        />
      </ConfigContext.Provider>,
    )

    expect(screen.getByText('agent.firstPrompt')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()

    fireEvent.click(screen.getByText('change-prompt'))

    expect(mockOnChange).toHaveBeenCalledWith('updated prompt')
  })

  it('should copy prompt text and manage external data tools', () => {
    render(
      <ConfigContext.Provider value={createContextValue({
        externalDataToolsConfig: [
          { variable: 'tool_existing', label: 'Tool Existing' },
        ],
      })}
      >
        <PromptEditor
          type="next-iteration"
          value="hello"
          onChange={mockOnChange}
        />
      </ConfigContext.Provider>,
    )

    fireEvent.click(screen.getByText('copy-prompt'))
    expect(mockCopy).toHaveBeenCalledWith('hello')
    expect(screen.getByText('copied')).toBeInTheDocument()

    fireEvent.click(screen.getByText('open-tool-modal'))
    expect(mockSetShowExternalDataToolModal).toHaveBeenCalledTimes(1)

    const modalConfig = mockSetShowExternalDataToolModal.mock.calls[0][0]

    expect(modalConfig.onValidateBeforeSaveCallback({ variable: 'existing_var' })).toBe(false)
    expect(mockToastError).toHaveBeenCalledWith('varKeyError.keyAlreadyExists')

    expect(modalConfig.onValidateBeforeSaveCallback({ variable: 'tool_existing' })).toBe(false)
    expect(mockToastError).toHaveBeenCalledWith('varKeyError.keyAlreadyExists')

    modalConfig.onSaveCallback({
      label: 'Search',
      variable: 'search_api',
    })

    expect(mockSetExternalDataToolsConfig).toHaveBeenCalledWith([
      { variable: 'tool_existing', label: 'Tool Existing' },
      { label: 'Search', variable: 'search_api' },
    ])
  })
})
