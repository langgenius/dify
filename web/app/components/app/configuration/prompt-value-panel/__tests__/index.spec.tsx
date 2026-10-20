import type { IPromptValuePanelProps } from '../index'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import ConfigContext from '@/context/debug-configuration'
import {
  createDebugConfigurationFixture,
  createModelConfigFixture,
} from '@/test/fixtures/debug-configuration'
import { ModelModeType, Resolution } from '@/types/app'
import PromptValuePanel from '../index'

const mockOnOpenFeatures = vi.fn()

// Use real store - global zustand mock will auto-reset between tests
vi.mock('@/app/components/base/features/new-feature-panel/feature-bar', () => ({
  default: ({
    onFeatureBarClick,
    disabled,
    hideEditEntrance,
  }: {
    onFeatureBarClick: () => void
    disabled?: boolean
    hideEditEntrance?: boolean
  }) => (
    <button
      type="button"
      disabled={disabled}
      data-hide-edit-entrance={hideEditEntrance ? 'true' : 'false'}
      onClick={onFeatureBarClick}
    >
      feature bar
    </button>
  ),
}))

vi.mock('@/app/components/base/image-uploader/text-generation-image-uploader', () => ({
  default: ({
    onFilesChange,
  }: {
    onFilesChange: (files: Array<Record<string, unknown>>) => void
  }) => (
    <button
      type="button"
      onClick={() =>
        onFilesChange([
          { progress: 100, type: 'local_file', url: 'https://example.com/a.png', fileId: 'file-1' },
          { progress: -1, type: 'remote_url', url: 'https://example.com/b.png', fileId: 'file-2' },
        ])
      }
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
]

const baseContextValue = createDebugConfigurationFixture({
  onOpenFeatures: mockOnOpenFeatures,
  modelModeType: ModelModeType.completion,
  modelConfig: createModelConfigFixture({
    configs: {
      prompt_template: 'prompt template',
      prompt_variables: promptVariables,
    },
  }),
  setInputs: mockSetInputs,
  canTestAndRun: true,
  mode: 'completion' as const,
  isAdvancedMode: false,
  completionPromptConfig: {
    prompt: { text: 'completion' },
    conversation_histories_role: { user_prefix: 'user', assistant_prefix: 'assistant' },
  },
  chatPromptConfig: { prompt: [] },
})

const defaultProps: IPromptValuePanelProps = {
  appType: 'completion',
  onSend: mockOnSend,
  inputs: { textVar: 'initial', boolVar: false },
  visionConfig: { enabled: false, number_limits: 0, detail: Resolution.low, transfer_methods: [] },
  onVisionFilesChange: vi.fn(),
}

const renderPanel = (
  options: {
    context?: Partial<typeof baseContextValue>
    props?: Partial<IPromptValuePanelProps>
  } = {},
) => {
  const contextValue = { ...baseContextValue, ...options.context }
  const props = { ...defaultProps, ...options.props }
  function ControlledPanel() {
    const [inputs, setInputs] = React.useState(props.inputs)
    return (
      <ConfigContext.Provider
        value={{
          ...contextValue,
          setInputs: (next) => {
            setInputs(next)
            mockSetInputs(next)
          },
        }}
      >
        <PromptValuePanel {...props} inputs={inputs} />
      </ConfigContext.Provider>
    )
  }
  return render(<ControlledPanel />)
}

describe('PromptValuePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updates inputs, clears values, and triggers run when ready', async () => {
    const user = userEvent.setup()
    renderPanel()

    const textInput = screen.getByRole('textbox', { name: 'Text Var' })
    await user.clear(textInput)
    await user.paste('updated')
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({ textVar: 'updated' }))

    const clearButton = screen.getByRole('button', { name: 'common.operation.clear' })
    await user.click(clearButton)

    expect(mockSetInputs).toHaveBeenLastCalledWith({
      textVar: '',
      boolVar: '',
    })

    const runButton = screen.getByRole('button', { name: 'appDebug.inputs.run' })
    expect(runButton).toBeEnabled()
    await user.click(runButton)
    await waitFor(() => expect(mockOnSend).toHaveBeenCalledTimes(1))
  })

  it('disables run when mode is not completion', () => {
    renderPanel({
      context: {
        mode: 'chat' as const,
      },
      props: {
        appType: 'chat',
      },
    })

    const runButton = screen.getByRole('button', { name: 'appDebug.inputs.run' })
    expect(runButton).toBeDisabled()
  })

  it('hydrates default values, supports advanced prompt gating, and toggles the feature panel', async () => {
    const user = userEvent.setup()
    renderPanel({
      context: {
        isAdvancedMode: true,
        modelModeType: ModelModeType.chat,
        chatPromptConfig: { prompt: [{ text: '' }] },
        modelConfig: createModelConfigFixture({
          configs: {
            prompt_template: '',
            prompt_variables: [
              {
                key: 'textVar',
                name: 'Text Var',
                type: 'string',
                default: 'default text',
                required: true,
              },
            ],
          },
        }),
      },
      props: {
        inputs: { textVar: '' },
      },
    })

    expect(mockSetInputs).toHaveBeenCalledWith({ textVar: 'default text' })
    expect(screen.getByRole('button', { name: 'appDebug.inputs.run' })).toBeDisabled()

    await user.click(screen.getByText('feature bar'))
    expect(mockOnOpenFeatures).toHaveBeenCalled()
  })

  it('disables run for advanced completion mode when the completion prompt is empty', () => {
    renderPanel({
      context: {
        isAdvancedMode: true,
        modelModeType: ModelModeType.completion,
        completionPromptConfig: {
          prompt: { text: '' },
          conversation_histories_role: { user_prefix: 'user', assistant_prefix: 'assistant' },
        },
        modelConfig: createModelConfigFixture({
          configs: {
            prompt_template: '',
            prompt_variables: [],
          },
        }),
      },
    })

    expect(screen.getByRole('button', { name: 'appDebug.inputs.run' })).toBeDisabled()
  })

  it('renders paragraph, select, number, checkbox, and vision inputs', async () => {
    const user = userEvent.setup()
    const onVisionFilesChange = vi.fn()
    renderPanel({
      context: {
        modelConfig: createModelConfigFixture({
          configs: {
            prompt_template: 'prompt template',
            prompt_variables: [
              { key: 'paragraphVar', name: 'Paragraph Var', type: 'paragraph', required: false },
              {
                key: 'selectVar',
                name: 'Select Var',
                type: 'select',
                options: ['a', 'b'],
                required: false,
              },
              { key: 'numberVar', name: 'Number Var', type: 'number', required: true },
              { key: 'boolVar', name: 'Boolean Var', type: 'checkbox', required: false },
            ],
          },
        }),
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

    await user.clear(screen.getByRole('textbox', { name: 'Paragraph Var' }))
    await user.paste('updated paragraph')
    await user.click(screen.getByRole('combobox', { name: 'Select Var' }))
    await user.click(await screen.findByRole('option', { name: 'b' }))
    await user.clear(screen.getByRole('spinbutton', { name: 'Number Var' }))
    await user.type(screen.getByRole('spinbutton', { name: 'Number Var' }), '2')
    await user.click(screen.getByRole('checkbox', { name: /Boolean Var/ }))
    await user.click(screen.getByText('image-uploader'))

    expect(mockSetInputs).toHaveBeenCalledWith(
      expect.objectContaining({ paragraphVar: 'updated paragraph' }),
    )
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({ selectVar: 'b' }))
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

  it('keeps debug actions enabled when readonly configuration still has test/run permission', () => {
    renderPanel({
      context: {
        readonly: true,
        canTestAndRun: true,
      },
    })

    expect(screen.getByRole('button', { name: 'common.operation.clear' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'appDebug.inputs.run' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'feature bar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'feature bar' })).toHaveAttribute(
      'data-hide-edit-entrance',
      'true',
    )
  })

  it('marks debug inputs and actions as disabled when test/run permission is missing even if configuration is editable', () => {
    renderPanel({
      context: {
        readonly: false,
        canTestAndRun: false,
      },
    })

    expect(screen.getByRole('textbox', { name: 'Text Var' })).toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: 'common.operation.clear' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'appDebug.inputs.run' })).toBeDisabled()
  })

  it('marks debug inputs and actions as disabled when configuration is readonly and test/run permission is missing', () => {
    renderPanel({
      context: {
        readonly: true,
        canTestAndRun: false,
      },
    })

    expect(screen.getByRole('textbox', { name: 'Text Var' })).toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: 'common.operation.clear' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'appDebug.inputs.run' })).toBeDisabled()
  })

  it('collapses the user input panel and hides the clear and run actions', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole('button', { name: 'appDebug.inputs.userInputField' }))

    expect(screen.queryByRole('button', { name: 'common.operation.clear' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'appDebug.inputs.run' })).not.toBeInTheDocument()
  })
})
