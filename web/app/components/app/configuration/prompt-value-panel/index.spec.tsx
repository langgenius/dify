import type { IPromptValuePanelProps } from './index'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ConfigContext from '@/context/debug-configuration'
import { AppModeEnum, ModelModeType, Resolution } from '@/types/app'
import PromptValuePanel from './index'

// Use real store - global zustand mock will auto-reset between tests
vi.mock('@/app/components/base/features/new-feature-panel/feature-bar', () => ({
  default: ({ onFeatureBarClick }: { onFeatureBarClick: () => void }) => (
    <button type="button" onClick={onFeatureBarClick}>
      feature bar
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
})
