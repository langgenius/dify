/* eslint-disable ts/no-explicit-any */
import type { IPromptValuePanelProps } from '../index'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ConfigContext from '@/context/debug-configuration'
import { AppModeEnum, ModelModeType, Resolution } from '@/types/app'
import PromptValuePanel from '../index'

const mockSetShowAppConfigureFeaturesModal = vi.fn()

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: { setShowAppConfigureFeaturesModal: typeof mockSetShowAppConfigureFeaturesModal }) => unknown) => selector({
    setShowAppConfigureFeaturesModal: mockSetShowAppConfigureFeaturesModal,
  }),
}))

// Use real store - global zustand mock will auto-reset between tests
vi.mock('@/app/components/base/features/new-feature-panel/feature-bar', () => ({
  default: ({ onFeatureBarClick }: { onFeatureBarClick: () => void }) => (
    <button type="button" onClick={onFeatureBarClick}>
      feature bar
    </button>
  ),
}))

vi.mock('@/app/components/base/select', () => ({
  default: ({ onSelect }: { onSelect: (item: { value: string }) => void }) => (
    <button type="button" onClick={() => onSelect({ value: 'selected-option' })}>select-input</button>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/before-run-form/bool-input', () => ({
  default: ({ onChange }: { onChange: (value: boolean) => void }) => (
    <button type="button" onClick={() => onChange(true)}>bool-input</button>
  ),
}))

vi.mock('@/app/components/base/image-uploader/text-generation-image-uploader', () => ({
  default: ({ onFilesChange }: { onFilesChange: (files: Array<Record<string, unknown>>) => void }) => (
    <button
      type="button"
      onClick={() => onFilesChange([
        { progress: 100, type: 'local_file', url: 'https://example.com/a.png', fileId: 'file-1' },
        { progress: -1, type: 'remote_url', url: 'https://example.com/b.png', fileId: 'file-2' },
      ])}
    >
      image-uploader
    </button>
  ),
}))

const mockSetInputs = vi.fn()
const mockOnSend = vi.fn()

const promptVariables = [
  { key: 'textVar', name: 'Text Var', type: 'string', required: true },
  { key: 'boolVar', name: 'Boolean Var', type: 'checkbox' },
] as const

const baseContextValue: any = {
  modelModeType: ModelModeType.completion,
  modelConfig: {
    configs: {
      prompt_template: 'prompt template',
      prompt_variables: promptVariables,
    },
  },
  setInputs: mockSetInputs,
  mode: AppModeEnum.COMPLETION,
  isAdvancedMode: false,
  completionPromptConfig: {
    prompt: { text: 'completion' },
    conversation_histories_role: { user_prefix: 'user', assistant_prefix: 'assistant' },
  },
  chatPromptConfig: { prompt: [] },
} as any

const defaultProps: IPromptValuePanelProps = {
  appType: AppModeEnum.COMPLETION,
  onSend: mockOnSend,
  inputs: { textVar: 'initial', boolVar: false },
  visionConfig: { enabled: false, number_limits: 0, detail: Resolution.low, transfer_methods: [] },
  onVisionFilesChange: vi.fn(),
}

const renderPanel = (options: {
  context?: Partial<typeof baseContextValue>
  props?: Partial<IPromptValuePanelProps>
} = {}) => {
  const contextValue = { ...baseContextValue, ...options.context }
  const props = { ...defaultProps, ...options.props }
  return render(
    <ConfigContext.Provider value={contextValue}>
      <PromptValuePanel {...props} />
    </ConfigContext.Provider>,
  )
}

describe('PromptValuePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSetInputs.mockClear()
    mockOnSend.mockClear()
    mockSetShowAppConfigureFeaturesModal.mockClear()
  })

  it('updates inputs, clears values, and triggers run when ready', async () => {
    renderPanel()

    const textInput = screen.getByPlaceholderText('Text Var')
    fireEvent.change(textInput, { target: { value: 'updated' } })
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({ textVar: 'updated' }))

    const clearButton = screen.getByRole('button', { name: 'common.operation.clear' })
    fireEvent.click(clearButton)

    expect(mockSetInputs).toHaveBeenLastCalledWith({
      textVar: '',
      boolVar: '',
    })

    const runButton = screen.getByRole('button', { name: 'appDebug.inputs.run' })
    expect(runButton).not.toBeDisabled()
    fireEvent.click(runButton)
    await waitFor(() => expect(mockOnSend).toHaveBeenCalledTimes(1))
  })

  it('disables run when mode is not completion', () => {
    renderPanel({
      context: {
        mode: AppModeEnum.CHAT,
      },
      props: {
        appType: AppModeEnum.CHAT,
      },
    })

    const runButton = screen.getByRole('button', { name: 'appDebug.inputs.run' })
    expect(runButton).toBeDisabled()
    fireEvent.click(runButton)
    expect(mockOnSend).not.toHaveBeenCalled()
  })

  it('hydrates default values, supports advanced prompt gating, and toggles the feature panel', () => {
    renderPanel({
      context: {
        isAdvancedMode: true,
        modelModeType: ModelModeType.chat,
        chatPromptConfig: { prompt: [{ text: '' }] },
        modelConfig: {
          configs: {
            prompt_template: '',
            prompt_variables: [
              { key: 'textVar', name: 'Text Var', type: 'string', default: 'default text', required: true },
            ],
          },
        },
      },
      props: {
        inputs: { textVar: '' },
      },
    })

    expect(mockSetInputs).toHaveBeenCalledWith({ textVar: 'default text' })
    expect(screen.getByRole('button', { name: 'appDebug.inputs.run' })).toBeDisabled()

    fireEvent.click(screen.getByText('feature bar'))
    expect(mockSetShowAppConfigureFeaturesModal).toHaveBeenCalled()
  })

  it('renders paragraph, select, number, checkbox, and vision inputs', () => {
    const onVisionFilesChange = vi.fn()
    renderPanel({
      context: {
        modelConfig: {
          configs: {
            prompt_template: 'prompt template',
            prompt_variables: [
              { key: 'paragraphVar', name: 'Paragraph Var', type: 'paragraph', required: false },
              { key: 'selectVar', name: 'Select Var', type: 'select', options: ['a', 'b'], required: false },
              { key: 'numberVar', name: 'Number Var', type: 'number', required: true },
              { key: 'boolVar', name: 'Boolean Var', type: 'checkbox', required: false },
            ],
          },
        },
      },
      props: {
        inputs: {
          paragraphVar: 'paragraph',
          selectVar: 'a',
          numberVar: '1',
          boolVar: false,
        },
        onVisionFilesChange,
        visionConfig: {
          enabled: true,
          number_limits: 2,
          detail: Resolution.high,
          transfer_methods: [],
        },
      },
    })

    fireEvent.change(screen.getByPlaceholderText('Paragraph Var'), { target: { value: 'updated paragraph' } })
    fireEvent.click(screen.getByText('select-input'))
    fireEvent.change(screen.getByDisplayValue('1'), { target: { value: '2' } })
    fireEvent.click(screen.getByText('bool-input'))
    fireEvent.click(screen.getByText('image-uploader'))

    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({ paragraphVar: 'updated paragraph' }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({ selectVar: 'selected-option' }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({ numberVar: '2' }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({ boolVar: true }))
    expect(onVisionFilesChange).toHaveBeenCalledWith([
      {
        type: 'image',
        transfer_method: 'local_file',
        url: 'https://example.com/a.png',
        upload_file_id: 'file-1',
      },
    ])
  })

  it('collapses the user input panel and hides the clear and run actions', () => {
    renderPanel()

    fireEvent.click(screen.getByText('appDebug.inputs.userInputField'))

    expect(screen.queryByRole('button', { name: 'common.operation.clear' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'appDebug.inputs.run' })).not.toBeInTheDocument()
  })
})
