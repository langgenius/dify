import type { InputValueTypes } from '../../types'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { fileUpload } from '@/app/components/base/file-uploader/utils'
import type { PromptConfig, PromptVariable } from '@/models/debug'
import type { SiteInfo } from '@/models/share'
import type { VisionSettings } from '@/types/app'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { Resolution, TransferMethod } from '@/types/app'
import { userInputsFormToPromptVariables } from '@/utils/model-config'
import { buildResultRequestData, validateResultRequest } from '../../result/result-request'
import RunOnce from '../index'

const createFileEntity = (overrides: Partial<FileEntity> = {}): FileEntity => ({
  id: 'default-file',
  name: 'default.txt',
  size: 128,
  type: 'text/plain',
  progress: 100,
  transferMethod: TransferMethod.local_file,
  supportFileType: 'document',
  uploadedId: 'default-upload',
  ...overrides,
})

vi.mock('@/hooks/use-breakpoints', () => {
  const MediaType = {
    pc: 'pc',
    pad: 'pad',
    mobile: 'mobile',
  }
  const mockUseBreakpoints = vi.fn(() => MediaType.pc)
  return {
    default: mockUseBreakpoints,
    MediaType,
  }
})

const upload = vi.hoisted(() => vi.fn<typeof fileUpload>())
vi.mock('@/next/navigation', () => ({
  useParams: () => ({}),
  usePathname: () => '/completion/app',
}))
vi.mock('@/app/components/base/file-uploader/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/components/base/file-uploader/utils')>()),
  fileUpload: upload,
}))

beforeEach(() => {
  upload.mockImplementation(({ file, onSuccessCallback }) => {
    onSuccessCallback({
      id: `upload-${file.name}`,
      name: file.name,
      size: file.size,
      mime_type: file.type,
      extension: 'txt',
      created_at: 1,
      created_by: 'user-1',
      preview_url: null,
      source_url: '',
    })
  })
})

const getInputs = () =>
  JSON.parse(screen.getByRole('status', { name: 'Input values' }).textContent!)

const createPromptVariable = (overrides: Partial<PromptVariable>): PromptVariable => ({
  key: 'input',
  name: 'Input',
  type: 'string',
  required: true,
  config: {
    allowed_file_types: ['document'],
    allowed_file_extensions: ['.txt'],
    allowed_file_upload_methods: [TransferMethod.local_file],
    number_limits: 2,
  },
  ...overrides,
})

const basePromptConfig: PromptConfig = {
  prompt_template: 'template',
  prompt_variables: [
    createPromptVariable({
      key: 'textInput',
      name: 'Text Input',
      type: 'string',
      default: 'default text',
    }),
    createPromptVariable({
      key: 'paragraphInput',
      name: 'Paragraph Input',
      type: 'paragraph',
      default: 'paragraph default',
    }),
    createPromptVariable({
      key: 'numberInput',
      name: 'Number Input',
      type: 'number',
      default: 42,
    }),
    createPromptVariable({
      key: 'checkboxInput',
      name: 'Checkbox Input',
      type: 'checkbox',
    }),
  ],
}

const baseVisionConfig: VisionSettings = {
  enabled: true,
  number_limits: 2,
  detail: Resolution.low,
  transfer_methods: [TransferMethod.local_file],
  image_file_size_limit: 5,
}

const siteInfo: SiteInfo = {
  title: 'Share',
}

const setup = (
  overrides: {
    promptConfig?: PromptConfig
    visionConfig?: VisionSettings
    runControl?: React.ComponentProps<typeof RunOnce>['runControl']
  } = {},
) => {
  const onInputsChange = vi.fn()
  const onSend = vi.fn()
  const onValidation = vi.fn()
  const onVisionFilesChange = vi.fn()

  const Wrapper = () => {
    const { t } = useTranslation(['share', 'appDebug', 'common', 'workflow'])
    const [inputs, setInputs] = useState<Record<string, InputValueTypes>>({})
    const inputsRef = useRef<Record<string, InputValueTypes>>({})
    return (
      <>
        <output aria-label="Input values">{JSON.stringify(inputs)}</output>
        <RunOnce
          siteInfo={siteInfo}
          promptConfig={overrides.promptConfig || basePromptConfig}
          inputs={inputs}
          inputsRef={inputsRef}
          onInputsChange={(updated) => {
            inputsRef.current = updated
            setInputs(updated)
            onInputsChange(updated)
          }}
          onSend={() => {
            const validation = validateResultRequest({
              completionFiles: [],
              inputs,
              isCallBatchAPI: false,
              promptConfig: overrides.promptConfig || basePromptConfig,
              t,
            })
            onValidation(validation)
            if (!validation.canSend) return
            onSend(
              buildResultRequestData({
                completionFiles: [],
                inputs,
                promptConfig: overrides.promptConfig || basePromptConfig,
                visionConfig: overrides.visionConfig || baseVisionConfig,
              }),
            )
          }}
          visionConfig={overrides.visionConfig || baseVisionConfig}
          onVisionFilesChange={onVisionFilesChange}
          runControl={overrides.runControl ?? null}
        />
      </>
    )
  }

  const utils = render(<Wrapper />)
  return {
    ...utils,
    onInputsChange,
    onSend,
    onValidation,
    onVisionFilesChange,
  }
}

describe('RunOnce', () => {
  it('should initialize inputs using prompt defaults', async () => {
    const { onInputsChange } = setup()

    await waitFor(() => {
      expect(onInputsChange).toHaveBeenCalledWith({
        textInput: 'default text',
        paragraphInput: 'paragraph default',
        numberInput: 42,
        checkboxInput: false,
      })
    })

    expect(screen.getByText('common.imageUploader.imageUpload'))!.toBeInTheDocument()
  })

  it('should update inputs when user edits fields', async () => {
    const user = userEvent.setup()
    const { onInputsChange } = setup()

    await waitFor(() => {
      expect(onInputsChange).toHaveBeenCalled()
    })
    onInputsChange.mockClear()

    const textInput = screen.getByRole('textbox', { name: 'Text Input' })
    await user.clear(textInput)
    await user.type(textInput, 'new text')

    const paragraphInput = screen.getByRole('textbox', { name: 'Paragraph Input' })
    await user.clear(paragraphInput)
    await user.type(paragraphInput, 'paragraph value')

    const numberInput = screen.getByRole('spinbutton', { name: 'Number Input' })
    await user.clear(numberInput)
    await user.type(numberInput, '99')

    await user.click(screen.getByRole('checkbox', { name: 'Checkbox Input' }))

    expect(getInputs()).toEqual({
      textInput: 'new text',
      paragraphInput: 'paragraph value',
      numberInput: '99',
      checkboxInput: true,
    })
  })

  it('should clear inputs when Clear button is pressed', async () => {
    const user = userEvent.setup()
    const { onInputsChange } = setup()
    await waitFor(() => {
      expect(onInputsChange).toHaveBeenCalled()
    })
    onInputsChange.mockClear()

    await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))

    expect(getInputs()).toEqual({
      textInput: '',
      paragraphInput: '',
      numberInput: '',
      checkboxInput: false,
    })
  })

  it('should submit form and call onSend when Run button clicked', async () => {
    const user = userEvent.setup()
    const { onSend, onInputsChange } = setup()
    await waitFor(() => {
      expect(onInputsChange).toHaveBeenCalled()
    })
    await user.click(screen.getByRole('button', { name: 'share.generation.run' }))
    expect(onSend).toHaveBeenCalledExactlyOnceWith({
      inputs: {
        textInput: 'default text',
        paragraphInput: 'paragraph default',
        numberInput: 42,
        checkboxInput: false,
      },
    })
  })

  it('should display stop controls when runControl is provided', async () => {
    const user = userEvent.setup()
    const onStop = vi.fn()
    const runControl = {
      onStop,
      isStopping: false,
    }
    const { onInputsChange } = setup({ runControl })
    await waitFor(() => {
      expect(onInputsChange).toHaveBeenCalled()
    })
    const stopButton = screen.getByRole('button', {
      name: 'share.generation.stopRun:{"defaultValue":"Stop Run"}',
    })
    await user.click(stopButton)
    expect(onStop).toHaveBeenCalledTimes(1)
  })

  it('should disable stop button while runControl is stopping', async () => {
    const runControl = {
      onStop: vi.fn(),
      isStopping: true,
    }
    const { onInputsChange } = setup({ runControl })
    await waitFor(() => {
      expect(onInputsChange).toHaveBeenCalled()
    })
    const stopButton = screen.getByRole('button', {
      name: 'share.generation.stopRun:{"defaultValue":"Stop Run"}',
    })
    expect(stopButton)!.toBeDisabled()
  })

  describe('select input type', () => {
    it('should render select input and handle selection', async () => {
      const user = userEvent.setup()
      const promptConfig: PromptConfig = {
        prompt_template: 'template',
        prompt_variables: [
          createPromptVariable({
            key: 'selectInput',
            name: 'Select Input',
            type: 'select',
            options: ['Option A', 'Option B', 'Option C'],
            default: 'Option A',
          }),
        ],
      }
      const { onInputsChange } = setup({
        promptConfig,
        visionConfig: { ...baseVisionConfig, enabled: false },
      })
      await waitFor(() => {
        expect(onInputsChange).toHaveBeenCalledWith({
          selectInput: 'Option A',
        })
      })
      await user.click(screen.getByRole('combobox', { name: 'Select Input' }))
      await user.click(screen.getByRole('option', { name: 'Option B' }))
      expect(getInputs()).toEqual({ selectInput: 'Option B' })
      expect(screen.getByRole('combobox', { name: 'Select Input' })).toHaveTextContent('Option B')
    })
  })

  describe('file input types', () => {
    it.each([
      { type: 'file', required: true },
      { type: 'file', required: false },
      { type: 'file-list', required: true },
      { type: 'file-list', required: false },
    ])(
      'should submit, clear and replace the configured $type default (required: $required)',
      async ({ type, required }) => {
        const user = userEvent.setup()
        const file = createFileEntity()
        const remoteFile = createFileEntity({
          id: 'remote-file',
          name: 'remote.txt',
          transferMethod: TransferMethod.remote_url,
          uploadedId: undefined,
          url: 'https://example.com/remote.txt',
        })
        const promptConfig: PromptConfig = {
          prompt_template: '',
          prompt_variables: userInputsFormToPromptVariables([
            {
              [type]: {
                variable: 'attachment',
                label: 'Attachment',
                required,
                default: type === 'file' ? file : [file, remoteFile],
                allowed_file_types: ['document'],
                allowed_file_upload_methods: [TransferMethod.local_file, TransferMethod.remote_url],
                max_length: 2,
              },
            },
          ]),
        }
        const { onSend, onValidation } = setup({
          promptConfig,
          visionConfig: { ...baseVisionConfig, enabled: false },
        })
        const uploadButton = await screen.findByRole('button', {
          name: 'common.fileUploader.uploadFromComputer',
        })
        const runButton = screen.getByRole('button', { name: 'share.generation.run' })
        const assertEmptySubmission = async () => {
          onSend.mockClear()
          await user.click(runButton)
          if (required) {
            expect(onValidation).toHaveBeenLastCalledWith(
              expect.objectContaining({ canSend: false }),
            )
            expect(onSend).not.toHaveBeenCalled()
          } else {
            expect(onSend).toHaveBeenLastCalledWith({
              inputs: { attachment: type === 'file' ? '' : [] },
            })
          }
        }

        expect(screen.getByText('default.txt')).toBeInTheDocument()
        expect(uploadButton).toBeDisabled()
        await user.click(runButton)
        const expectedFile = {
          type: 'document',
          transfer_method: TransferMethod.local_file,
          upload_file_id: 'default-upload',
          url: '',
        }
        const expectedRemoteFile = {
          type: 'document',
          transfer_method: TransferMethod.remote_url,
          upload_file_id: '',
          url: 'https://example.com/remote.txt',
        }
        expect(onSend).toHaveBeenLastCalledWith({
          inputs: {
            attachment: type === 'file' ? expectedFile : [expectedFile, expectedRemoteFile],
          },
        })

        await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))
        expect(screen.queryByText('default.txt')).not.toBeInTheDocument()
        expect(screen.queryByText('remote.txt')).not.toBeInTheDocument()
        expect(uploadButton).toBeEnabled()
        await assertEmptySubmission()

        const replacementFile = new File(['replacement'], 'replacement.txt', { type: 'text/plain' })
        const remainingFile = new File(['remaining'], 'remaining.txt', { type: 'text/plain' })
        await user.upload(
          uploadButton.querySelector('input')!,
          type === 'file' ? replacementFile : [replacementFile, remainingFile],
        )
        await waitFor(() => {
          const uploaded = expect.objectContaining({
            uploadedId: 'upload-replacement.txt',
            progress: 100,
          })
          const remaining = expect.objectContaining({
            uploadedId: 'upload-remaining.txt',
            progress: 100,
          })
          expect(getInputs()).toEqual({
            attachment: type === 'file' ? uploaded : [uploaded, remaining],
          })
        })
        expect(screen.getByText('replacement.txt')).toBeInTheDocument()
        await user.click(runButton)
        const expectedReplacementFile = {
          ...expectedFile,
          upload_file_id: 'upload-replacement.txt',
        }
        const expectedRemainingFile = { ...expectedFile, upload_file_id: 'upload-remaining.txt' }
        expect(onSend).toHaveBeenLastCalledWith({
          inputs: {
            attachment:
              type === 'file'
                ? expectedReplacementFile
                : [expectedReplacementFile, expectedRemainingFile],
          },
        })

        await user.click(
          screen.getByRole('button', { name: 'common.operation.remove replacement.txt' }),
        )
        expect(screen.queryByText('replacement.txt')).not.toBeInTheDocument()
        if (type === 'file-list') {
          expect(screen.getByText('remaining.txt')).toBeInTheDocument()
          await user.click(runButton)
          expect(onSend).toHaveBeenLastCalledWith({
            inputs: { attachment: [expectedRemainingFile] },
          })
          await user.click(
            screen.getByRole('button', { name: 'common.operation.remove remaining.txt' }),
          )
          expect(screen.queryByText('remaining.txt')).not.toBeInTheDocument()
        }
        expect(uploadButton).toBeEnabled()
        await assertEmptySubmission()
      },
    )
  })

  describe('json_object input type', () => {
    it('should update json_object input when code editor changes', async () => {
      const user = userEvent.setup()
      const promptConfig: PromptConfig = {
        prompt_template: 'template',
        prompt_variables: [
          createPromptVariable({
            key: 'jsonInput',
            name: 'JSON Input',
            type: 'json_object' as PromptVariable['type'],
          }),
        ],
      }
      const { onInputsChange } = setup({
        promptConfig,
        visionConfig: { ...baseVisionConfig, enabled: false },
      })
      await waitFor(() => {
        expect(onInputsChange).toHaveBeenCalled()
      })
      onInputsChange.mockClear()

      const codeEditor = screen.getByTestId('monaco-editor')
      await user.click(codeEditor)
      await user.paste('{"key": "value"}')

      await waitFor(() => {
        expect(getInputs()).toEqual({
          jsonInput: '{"key": "value"}',
        })
      })
    })
  })

  describe('hidden and optional fields', () => {
    it('should not render hidden variables', async () => {
      const promptConfig: PromptConfig = {
        prompt_template: 'template',
        prompt_variables: [
          createPromptVariable({
            key: 'hiddenInput',
            name: 'Hidden Input',
            type: 'string',
            hide: true,
          }),
          createPromptVariable({
            key: 'visibleInput',
            name: 'Visible Input',
            type: 'string',
          }),
        ],
      }
      const { onInputsChange } = setup({
        promptConfig,
        visionConfig: { ...baseVisionConfig, enabled: false },
      })
      await waitFor(() => {
        expect(onInputsChange).toHaveBeenCalled()
      })
      expect(screen.queryByText('Hidden Input')).not.toBeInTheDocument()
      expect(screen.getByText('Visible Input'))!.toBeInTheDocument()
    })

    it('should show optional label for non-required fields', async () => {
      const promptConfig: PromptConfig = {
        prompt_template: 'template',
        prompt_variables: [
          createPromptVariable({
            key: 'optionalInput',
            name: 'Optional Input',
            type: 'string',
            required: false,
          }),
        ],
      }
      const { onInputsChange } = setup({
        promptConfig,
        visionConfig: { ...baseVisionConfig, enabled: false },
      })
      await waitFor(() => {
        expect(onInputsChange).toHaveBeenCalled()
      })
      expect(screen.getByText('workflow.panel.optional'))!.toBeInTheDocument()
    })
  })

  describe('vision uploader', () => {
    it('should not render vision uploader when disabled', async () => {
      const { onInputsChange } = setup({ visionConfig: { ...baseVisionConfig, enabled: false } })
      await waitFor(() => {
        expect(onInputsChange).toHaveBeenCalled()
      })
      expect(screen.queryByText('common.imageUploader.imageUpload')).not.toBeInTheDocument()
    })
  })

  describe('clear with different input types', () => {
    it('should clear select input to undefined', async () => {
      const user = userEvent.setup()
      const promptConfig: PromptConfig = {
        prompt_template: 'template',
        prompt_variables: [
          createPromptVariable({
            key: 'selectInput',
            name: 'Select Input',
            type: 'select',
            options: ['Option A', 'Option B'],
            default: 'Option A',
          }),
        ],
      }
      const { onInputsChange } = setup({
        promptConfig,
        visionConfig: { ...baseVisionConfig, enabled: false },
      })
      await waitFor(() => {
        expect(onInputsChange).toHaveBeenCalled()
      })
      onInputsChange.mockClear()

      await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))

      expect(onInputsChange).toHaveBeenCalledWith({
        selectInput: undefined,
      })
    })
  })

  describe('maxLength behavior', () => {
    it('should not have maxLength attribute when max_length is zero', async () => {
      const promptConfig: PromptConfig = {
        prompt_template: 'template',
        prompt_variables: [
          createPromptVariable({
            key: 'textInput',
            name: 'Text Input',
            type: 'string',
            max_length: 0,
          }),
        ],
      }
      const { onInputsChange } = setup({
        promptConfig,
        visionConfig: { ...baseVisionConfig, enabled: false },
      })
      await waitFor(() => {
        expect(onInputsChange).toHaveBeenCalled()
      })
      const input = screen.getByRole('textbox', { name: 'Text Input' })
      expect(input).not.toHaveAttribute('maxLength')
    })

    it('should have maxLength attribute when max_length is set', async () => {
      const promptConfig: PromptConfig = {
        prompt_template: 'template',
        prompt_variables: [
          createPromptVariable({
            key: 'textInput',
            name: 'Text Input',
            type: 'string',
            max_length: 100,
          }),
        ],
      }
      const { onInputsChange } = setup({
        promptConfig,
        visionConfig: { ...baseVisionConfig, enabled: false },
      })
      await waitFor(() => {
        expect(onInputsChange).toHaveBeenCalled()
      })
      const input = screen.getByRole('textbox', { name: 'Text Input' })
      expect(input)!.toHaveAttribute('maxLength', '100')
    })
  })
})
