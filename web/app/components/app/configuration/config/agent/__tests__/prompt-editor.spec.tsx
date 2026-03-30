import type { ComponentProps } from 'react'
import type { PromptEditorProps as BasePromptEditorProps } from '@/app/components/base/prompt-editor'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from '@/app/components/base/ui/toast'
import ConfigContext from '@/context/debug-configuration'
import PromptEditor from '../prompt-editor'

type ContextValue = ComponentProps<typeof ConfigContext.Provider>['value']

const mockCopy = vi.fn()
const mockSetShowExternalDataToolModal = vi.fn()
const mockPromptEditor = vi.fn()
const mockSetExternalDataToolsConfig = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) => values?.key ?? key,
  }),
}))

vi.mock('copy-to-clipboard', () => ({
  default: (...args: unknown[]) => mockCopy(...args),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowExternalDataToolModal: mockSetShowExternalDataToolModal,
  }),
}))

vi.mock('@/utils/classnames', () => ({
  cn: (...args: Array<string | undefined | false | null>) => args.filter(Boolean).join(' '),
}))

vi.mock('@/app/components/base/icons/src/vender/line/files', () => ({
  Copy: ({ onClick }: { onClick?: () => void }) => <button type="button" onClick={onClick}>copy-icon</button>,
  CopyCheck: () => <div>copied-icon</div>,
}))

vi.mock('@/app/components/base/prompt-editor', () => ({
  default: (props: BasePromptEditorProps) => {
    mockPromptEditor(props)
    return (
      <div data-testid="prompt-editor">
        <button type="button" onClick={() => props.externalToolBlock?.onAddExternalTool?.()}>add-external-tool</button>
      </div>
    )
  },
}))

const createContextValue = (overrides: Partial<ContextValue> = {}): ContextValue => ({
  modelConfig: {
    configs: {
      prompt_variables: [
        { key: 'customer_name', name: 'Customer Name' },
        { key: '', name: 'Ignored' },
      ],
    },
  },
  hasSetBlockStatus: {
    context: false,
  },
  dataSets: [
    { id: 'dataset-1', name: 'Knowledge Base', data_source_type: 'notion' },
  ],
  showSelectDataSet: vi.fn(),
  externalDataToolsConfig: [
    { label: 'Search API', variable: 'search_api', icon: 'icon.png', icon_background: '#fff' },
  ],
  setExternalDataToolsConfig: mockSetExternalDataToolsConfig,
  ...overrides,
} as ContextValue)

const renderEditor = (contextOverrides: Partial<ContextValue> = {}, props: Partial<ComponentProps<typeof PromptEditor>> = {}) => {
  return render(
    <ConfigContext.Provider value={createContextValue(contextOverrides)}>
      <PromptEditor
        type="first-prompt"
        value="Hello world"
        onChange={vi.fn()}
        {...props}
      />
    </ConfigContext.Provider>,
  )
}

describe('agent prompt-editor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should copy the current prompt and toggle the copied feedback', () => {
    renderEditor()

    fireEvent.click(screen.getByRole('button', { name: 'copy-icon' }))

    expect(mockCopy).toHaveBeenCalledWith('Hello world')
    expect(screen.getByText('copied-icon')).toBeInTheDocument()
  })

  it('should pass context, variable, and external tool blocks into the shared prompt editor', () => {
    const showSelectDataSet = vi.fn()
    renderEditor({ showSelectDataSet })

    expect(mockPromptEditor).toHaveBeenCalledWith(expect.objectContaining({
      value: 'Hello world',
      contextBlock: expect.objectContaining({
        show: true,
        selectable: true,
        datasets: [{ id: 'dataset-1', name: 'Knowledge Base', type: 'notion' }],
        onAddContext: showSelectDataSet,
      }),
      variableBlock: {
        show: true,
        variables: [{ name: 'Customer Name', value: 'customer_name' }],
      },
      externalToolBlock: expect.objectContaining({
        show: true,
        externalTools: [{ name: 'Search API', variableName: 'search_api', icon: 'icon.png', icon_background: '#fff' }],
      }),
    }))
    expect(screen.getByText('11')).toBeInTheDocument()
  })

  it('should reject duplicated external tool variables before save', () => {
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'add-external-tool' }))

    const modalPayload = mockSetShowExternalDataToolModal.mock.calls[0][0]

    expect(modalPayload.onValidateBeforeSaveCallback({ variable: 'customer_name' })).toBe(false)
    expect(modalPayload.onValidateBeforeSaveCallback({ variable: 'search_api' })).toBe(false)
    expect(toast.error).toHaveBeenNthCalledWith(1, 'customer_name')
    expect(toast.error).toHaveBeenNthCalledWith(2, 'search_api')
  })

  it('should append a new external tool when validation passes', () => {
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'add-external-tool' }))

    const modalPayload = mockSetShowExternalDataToolModal.mock.calls[0][0]
    const newTool = { label: 'CRM API', variable: 'crm_api' }

    expect(modalPayload.onValidateBeforeSaveCallback(newTool)).toBe(true)
    modalPayload.onSaveCallback(newTool)

    expect(mockSetExternalDataToolsConfig).toHaveBeenCalledWith([
      { label: 'Search API', variable: 'search_api', icon: 'icon.png', icon_background: '#fff' },
      newTool,
    ])
  })
})
