import type { IPromptValuePanelProps } from '../index'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { FeaturesContext } from '@/app/components/base/features/context'
import { useFeatures } from '@/app/components/base/features/hooks'
import { createFeaturesStore } from '@/app/components/base/features/store'
import { imageUpload } from '@/app/components/base/image-uploader/utils'
import ConfigContext from '@/context/debug-configuration'
import {
  createDebugConfigurationFixture,
  createModelConfigFixture,
} from '@/test/fixtures/debug-configuration'
import { ModelModeType, Resolution, TransferMethod } from '@/types/app'
import PromptValuePanel from '../index'

vi.mock('@/app/components/base/image-uploader/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/components/base/image-uploader/utils')>()),
  imageUpload: vi.fn(),
}))

const mockOnSend = vi.fn()

const promptVariables = [
  { key: 'textVar', name: 'Text Var', type: 'string', required: true },
  { key: 'boolVar', name: 'Boolean Var', type: 'checkbox' },
]

const baseContextValue = createDebugConfigurationFixture({
  modelModeType: ModelModeType.completion,
  modelConfig: createModelConfigFixture({
    configs: {
      prompt_template: 'prompt template',
      prompt_variables: promptVariables,
    },
  }),
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

function FeaturesModalProbe() {
  const showFeaturesModal = useFeatures((state) => state.showFeaturesModal)
  return showFeaturesModal ? <div role="dialog" aria-label="workflow.common.features" /> : null
}

const renderPanel = (
  options: {
    context?: Partial<typeof baseContextValue>
    props?: Partial<IPromptValuePanelProps>
  } = {},
) => {
  const contextValue = { ...baseContextValue, ...options.context }
  const props = { ...defaultProps, ...options.props }
  const featuresStore = createFeaturesStore()
  function ControlledPanel() {
    const [inputs, setInputs] = React.useState(props.inputs)
    return (
      <ConfigContext.Provider
        value={{
          ...contextValue,
          setInputs,
          onOpenFeatures: () => featuresStore.getState().setShowFeaturesModal(true),
        }}
      >
        <PromptValuePanel {...props} inputs={inputs} onSend={() => mockOnSend(inputs)} />
      </ConfigContext.Provider>
    )
  }
  return render(
    <FeaturesContext value={featuresStore}>
      <ControlledPanel />
      <FeaturesModalProbe />
    </FeaturesContext>,
  )
}

describe('PromptValuePanel', () => {
  it('updates inputs, clears values, and triggers run when ready', async () => {
    const user = userEvent.setup()
    renderPanel()

    const textInput = screen.getByRole('textbox', { name: 'Text Var' })
    await user.clear(textInput)
    await user.paste('updated')
    expect(textInput).toHaveValue('updated')

    const clearButton = screen.getByRole('button', { name: 'common.operation.clear' })
    await user.click(clearButton)

    expect(textInput).toHaveValue('')
    expect(screen.getByRole('checkbox', { name: /Boolean Var/ })).not.toBeChecked()

    const runButton = screen.getByRole('button', { name: 'appDebug.inputs.run' })
    expect(runButton).toBeEnabled()
    await user.click(runButton)
    await waitFor(() =>
      expect(mockOnSend).toHaveBeenCalledExactlyOnceWith({ textVar: '', boolVar: '' }),
    )
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

    expect(screen.getByRole('textbox', { name: 'Text Var' })).toHaveValue('default text')
    expect(screen.getByRole('button', { name: 'appDebug.inputs.run' })).toBeDisabled()

    expect(
      screen.queryByRole('dialog', { name: 'workflow.common.features' }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'appDebug.feature.bar.empty' }))
    expect(await screen.findByRole('dialog', { name: 'workflow.common.features' })).toBeVisible()
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
          transfer_methods: [TransferMethod.local_file, TransferMethod.remote_url],
          image_file_size_limit: 10,
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
    expect(screen.getByRole('textbox', { name: 'Paragraph Var' })).toHaveValue('updated paragraph')
    expect(screen.getByRole('combobox', { name: 'Select Var' })).toHaveTextContent('b')
    expect(screen.getByRole('spinbutton', { name: 'Number Var' })).toHaveValue(2)
    expect(screen.getByRole('checkbox', { name: /Boolean Var/ })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'appDebug.inputs.run' }))
    expect(mockOnSend).toHaveBeenCalledExactlyOnceWith({
      paragraphVar: 'updated paragraph',
      selectVar: 'b',
      numberVar: '2',
      boolVar: true,
    })

    const file = new File(['image'], 'sample.png', { type: 'image/png' })
    await user.upload(screen.getByTestId('local-file-input'), file)
    await waitFor(() => expect(imageUpload).toHaveBeenCalledOnce())
    expect(vi.mocked(imageUpload).mock.calls[0]![0].file).toBe(file)
    act(() => vi.mocked(imageUpload).mock.calls[0]![0].onSuccessCallback({ id: 'file-1' }))
    await waitFor(() =>
      expect(onVisionFilesChange).toHaveBeenLastCalledWith([
        {
          type: 'image',
          transfer_method: 'local_file',
          url: expect.stringMatching(/^data:image\/png;base64,/),
          upload_file_id: 'file-1',
        },
      ]),
    )
    // The browser reports remote image failure; failed images must not enter the run payload.
    await user.click(screen.getByRole('button', { name: 'common.imageUploader.pasteImageLink' }))
    await user.type(
      screen.getByPlaceholderText('common.imageUploader.pasteImageLinkInputPlaceholder'),
      'https://example.com/b.png',
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.ok' }))
    fireEvent.error(
      screen
        .getAllByRole('presentation')
        .find((image) => image.getAttribute('src') === 'https://example.com/b.png')!,
    )
    expect(onVisionFilesChange).toHaveBeenLastCalledWith([
      {
        type: 'image',
        transfer_method: 'local_file',
        url: expect.stringMatching(/^data:image\/png;base64,/),
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
    expect(screen.getByRole('button', { name: 'appDebug.feature.bar.empty' })).toBeDisabled()
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
