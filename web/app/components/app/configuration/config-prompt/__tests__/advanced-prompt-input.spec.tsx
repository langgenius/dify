/* eslint-disable ts/no-explicit-any */
import type { ReactNode } from 'react'
import type { PromptRole } from '@/models/debug'
import { fireEvent, render, screen } from '@testing-library/react'
import { INSERT_VARIABLE_VALUE_BLOCK_COMMAND } from '@/app/components/base/prompt-editor/plugins/variable-block'
import ConfigContext from '@/context/debug-configuration'
import { AppModeEnum } from '@/types/app'
import AdvancedPromptInput from '../advanced-prompt-input'

const mockEmit = vi.fn()
const mockSetShowExternalDataToolModal = vi.fn()
const mockSetModelConfig = vi.fn()
const mockOnTypeChange = vi.fn()
const mockOnChange = vi.fn()
const mockOnDelete = vi.fn()
const mockOnHideContextMissingTip = vi.fn()
const mockCopy = vi.fn()
const mockToastError = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('copy-to-clipboard', () => ({
  default: (...args: unknown[]) => mockCopy(...args),
}))

vi.mock('@remixicon/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@remixicon/react')>()
  return {
    ...actual,
    RiDeleteBinLine: ({ onClick }: { onClick: () => void }) => (
      <button onClick={onClick}>delete-prompt</button>
    ),
    RiErrorWarningFill: () => <span>warning-icon</span>,
  }
})

vi.mock('@/app/components/base/icons/src/vender/line/files', () => ({
  Copy: ({ onClick }: { onClick: () => void }) => (
    <button onClick={onClick}>copy-prompt</button>
  ),
  CopyCheck: () => <span>copy-checked</span>,
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: {
      emit: (...args: unknown[]) => mockEmit(...args),
    },
  }),
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

vi.mock('../message-type-selector', () => ({
  default: ({ onChange, value }: { onChange: (value: PromptRole) => void, value: PromptRole }) => (
    <button onClick={() => onChange('assistant' as PromptRole)}>{`selector:${value}`}</button>
  ),
}))

vi.mock('@/app/components/base/prompt-editor', () => ({
  default: (props: {
    onBlur: () => void
    onChange: (value: string) => void
    externalToolBlock: { onAddExternalTool: () => void }
  }) => (
    <div>
      <button onClick={() => props.onChange('Updated {{new_var}}')}>change-advanced</button>
      <button onClick={props.onBlur}>blur-advanced</button>
      <button onClick={props.externalToolBlock.onAddExternalTool}>open-advanced-tool-modal</button>
    </div>
  ),
}))

vi.mock('../prompt-editor-height-resize-wrap', () => ({
  default: ({ children, footer }: { children: ReactNode, footer: ReactNode }) => (
    <div>
      {children}
      {footer}
    </div>
  ),
}))

const createContextValue = () => ({
  mode: AppModeEnum.CHAT,
  hasSetBlockStatus: {
    context: false,
    history: false,
    query: false,
  },
  modelConfig: {
    configs: {
      prompt_variables: [
        { key: 'existing_var', name: 'Existing', type: 'string', required: true },
      ],
    },
  },
  setModelConfig: mockSetModelConfig,
  conversationHistoriesRole: {
    user_prefix: 'user',
    assistant_prefix: 'assistant',
  },
  showHistoryModal: vi.fn(),
  dataSets: [],
  showSelectDataSet: vi.fn(),
  externalDataToolsConfig: [],
}) as any

describe('AdvancedPromptInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should delegate prompt text and role changes to the parent callbacks', () => {
    render(
      <ConfigContext.Provider value={createContextValue()}>
        <AdvancedPromptInput
          type={'user' as PromptRole}
          isChatMode
          value="Hello"
          onChange={mockOnChange}
          onTypeChange={mockOnTypeChange}
          canDelete
          onDelete={mockOnDelete}
          promptVariables={[]}
          isContextMissing={false}
          onHideContextMissingTip={mockOnHideContextMissingTip}
        />
      </ConfigContext.Provider>,
    )

    fireEvent.click(screen.getByText('change-advanced'))
    fireEvent.click(screen.getByText('selector:user'))
    fireEvent.click(screen.getByText('copy-prompt'))
    fireEvent.click(screen.getByText('delete-prompt'))

    expect(mockOnChange).toHaveBeenCalledWith('Updated {{new_var}}')
    expect(mockOnTypeChange).toHaveBeenCalledWith('assistant')
    expect(mockCopy).toHaveBeenCalledWith('Hello')
    expect(mockOnDelete).toHaveBeenCalled()
  })

  it('should add newly discovered variables after blur confirmation', () => {
    render(
      <ConfigContext.Provider value={createContextValue()}>
        <AdvancedPromptInput
          type={'user' as PromptRole}
          isChatMode
          value="Hello {{new_var}}"
          onChange={mockOnChange}
          onTypeChange={mockOnTypeChange}
          canDelete={false}
          onDelete={mockOnDelete}
          promptVariables={[]}
          isContextMissing={false}
          onHideContextMissingTip={mockOnHideContextMissingTip}
        />
      </ConfigContext.Provider>,
    )

    fireEvent.click(screen.getByText('blur-advanced'))
    fireEvent.click(screen.getByText('operation.add'))

    expect(mockSetModelConfig).toHaveBeenCalledWith(expect.objectContaining({
      configs: expect.objectContaining({
        prompt_variables: expect.arrayContaining([
          expect.objectContaining({
            key: 'new_var',
            name: 'new_var',
          }),
        ]),
      }),
    }))
  })

  it('should open the external data tool modal and validate duplicates', () => {
    render(
      <ConfigContext.Provider value={createContextValue()}>
        <AdvancedPromptInput
          type={'user' as PromptRole}
          isChatMode
          value="Hello"
          onChange={mockOnChange}
          onTypeChange={mockOnTypeChange}
          canDelete={false}
          onDelete={mockOnDelete}
          promptVariables={[
            { key: 'existing_var', name: 'Existing', type: 'string', required: true },
          ]}
          isContextMissing={false}
          onHideContextMissingTip={mockOnHideContextMissingTip}
        />
      </ConfigContext.Provider>,
    )

    fireEvent.click(screen.getByText('open-advanced-tool-modal'))

    const modalConfig = mockSetShowExternalDataToolModal.mock.calls[0]![0]
    expect(modalConfig.onValidateBeforeSaveCallback({ variable: 'existing_var' })).toBe(false)
    expect(mockToastError).toHaveBeenCalledWith('varKeyError.keyAlreadyExists')

    modalConfig.onSaveCallback({
      label: 'Search',
      variable: 'search_api',
    })

    expect(mockEmit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ADD_EXTERNAL_DATA_TOOL',
    }))
    expect(mockEmit).toHaveBeenCalledWith(expect.objectContaining({
      payload: 'search_api',
      type: INSERT_VARIABLE_VALUE_BLOCK_COMMAND,
    }))
  })
})
