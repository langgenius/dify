import type { InputValueTypes } from '../../types'
import type { PromptConfig, PromptVariable } from '@/models/debug'
import type { SiteInfo } from '@/models/share'
import type { VisionFile, VisionSettings } from '@/types/app'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { Resolution, TransferMethod } from '@/types/app'
import RunOnce from '../index'

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

vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: ({ value, onChange }: { value?: string, onChange?: (val: string) => void }) => (
    <textarea data-testid="code-editor-mock" value={value} onChange={e => onChange?.(e.target.value)} />
  ),
}))

vi.mock('@/app/components/base/image-uploader/text-generation-image-uploader', () => {
  function TextGenerationImageUploaderMock({ onFilesChange }: { onFilesChange: (files: VisionFile[]) => void }) {
    useEffect(() => {
      onFilesChange([])
    }, [onFilesChange])
    return <div data-testid="vision-uploader-mock" />
  }
  return {
    default: TextGenerationImageUploaderMock,
  }
})

vi.mock('@/app/components/base/file-uploader', () => ({
  FileUploaderInAttachmentWrapper: ({ value, onChange }: { value: object[], onChange: (files: object[]) => void }) => (
    <div data-testid="file-uploader-mock">
      <button onClick={() => onChange([{ id: 'test-file' }])}>Upload</button>
      <span>
        {value?.length || 0}
        {' '}
        files
      </span>
    </div>
  ),
}))

const createPromptVariable = (overrides: Partial<PromptVariable>): PromptVariable => ({
  key: 'input',
  name: 'Input',
  type: 'string',
  required: true,
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

const setup = (overrides: {
  promptConfig?: PromptConfig
  visionConfig?: VisionSettings
  runControl?: React.ComponentProps<typeof RunOnce>['runControl']
} = {}) => {
  const onInputsChange = vi.fn()
  const onSend = vi.fn()
  const onVisionFilesChange = vi.fn()
  let inputsRefCapture: React.MutableRefObject<Record<string, InputValueTypes>> | null = null

  const Wrapper = () => {
    const [inputs, setInputs] = useState<Record<string, InputValueTypes>>({})
    const inputsRef = useRef<Record<string, InputValueTypes>>({})
    inputsRefCapture = inputsRef
    return (
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
        onSend={onSend}
        visionConfig={overrides.visionConfig || baseVisionConfig}
        onVisionFilesChange={onVisionFilesChange}
        runControl={overrides.runControl ?? null}
      />
    )
  }

  const utils = render(<Wrapper />)
  return {
    ...utils,
    onInputsChange,
    onSend,
    onVisionFilesChange,
    getInputsRef: () => inputsRefCapture,
  }
}

describe('RunOnce', () => {
  it('should initialize inputs using prompt defaults', async () => {
    const { onInputsChange, onVisionFilesChange } = setup()

    await waitFor(() => {
      expect(onInputsChange).toHaveBeenCalledWith({
        textInput: 'default text',
        paragraphInput: 'paragraph default',
        numberInput: 42,
        checkboxInput: false,
      })
    })

    await waitFor(() => {
      expect(onVisionFilesChange).toHaveBeenCalledWith([])
    })

    expect(screen.getByText('common.imageUploader.imageUpload')).toBeInTheDocument()
  })

  it('should update inputs when user edits fields', async () => {
    const { onInputsChange, getInputsRef } = setup()

    await waitFor(() => {
      expect(onInputsChange).toHaveBeenCalled()
    })
    onInputsChange.mockClear()

    fireEvent.change(screen.getByPlaceholderText('Text Input'), {
      target: { value: 'new text' },
    })
    fireEvent.change(screen.getByPlaceholderText('Paragraph Input'), {
      target: { value: 'paragraph value' },
    })
    fireEvent.change(screen.getByPlaceholderText('Number Input'), {
      target: { value: '99' },
    })

    const label = screen.getByText('Checkbox Input')
    const checkbox = label.closest('div')?.parentElement?.querySelector('div')
    expect(checkbox).toBeTruthy()
    fireEvent.click(checkbox as HTMLElement)

    const latest = onInputsChange.mock.calls[onInputsChange.mock.calls.length - 1][0]
    expect(latest).toEqual({
      textInput: 'new text',
      paragraphInput: 'paragraph value',
      numberInput: '99',
      checkboxInput: true,
    })
    expect(getInputsRef()?.current).toEqual(latest)
  })

  it('should clear inputs when Clear button is pressed', async () => {
    const { onInputsChange } = setup()
    await waitFor(() => {
      expect(onInputsChange).toHaveBeenCalled()
    })
    onInputsChange.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.clear' }))

    expect(onInputsChange).toHaveBeenCalledWith({
      textInput: '',
      paragraphInput: '',
      numberInput: '',
      checkboxInput: false,
    })
  })

  it('should submit form and call onSend when Run button clicked', async () => {
    const { onSend, onInputsChange } = setup()
    await waitFor(() => {
      expect(onInputsChange).toHaveBeenCalled()
    })
    fireEvent.click(screen.getByTestId('run-button'))
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('should display stop controls when runControl is provided', async () => {
    const onStop = vi.fn()
    const runControl = {
      onStop,
      isStopping: false,
    }
    const { onInputsChange } = setup({ runControl })
    await waitFor(() => {
      expect(onInputsChange).toHaveBeenCalled()
    })
    const stopButton = screen.getByTestId('stop-button')
    fireEvent.click(stopButton)
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
    const stopButton = screen.getByTestId('stop-button')
    expect(stopButton).toBeDisabled()
  })

  describe('select input type', () => {
    it('should render select input and handle selection', async () => {
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
      const { onInputsChange } = setup({ promptConfig, visionConfig: { ...baseVisionConfig, enabled: false } })
      await waitFor(() => {
        expect(onInputsChange).toHaveBeenCalledWith({
          selectInput: 'Option A',
        })
      })
      expect(screen.getByText('Select Input')).toBeInTheDocument()
    })
  })

  describe('file input types', () => {
    it('should render file uploader for single file input', async () => {
      const promptConfig: PromptConfig = {
        prompt_template: 'template',
        prompt_variables: [
          createPromptVariable({
            key: 'fileInput',
            name: 'File Input',
            type: 'file',
          }),
        ],
      }
      const { onInputsChange } = setup({ promptConfig, visionConfig: { ...baseVisionConfig, enabled: false } })
      await waitFor(() => {
        expect(onInputsChange).toHaveBeenCalledWith({
          fileInput: undefined,
        })
      })
      expect(screen.getByText('File Input')).toBeInTheDocument()
    })

    it('should render file uploader for file-list input', async () => {
      const promptConfig: PromptConfig = {
        prompt_template: 'template',
        prompt_variables: [
          createPromptVariable({
            key: 'fileListInput',
            name: 'File List Input',
            type: 'file-list',
          }),
        ],
      }
      const { onInputsChange } = setup({ promptConfig, visionConfig: { ...baseVisionConfig, enabled: false } })
      await waitFor(() => {
        expect(onInputsChange).toHaveBeenCalledWith({
          fileListInput: [],
        })
      })
      expect(screen.getByText('File List Input')).toBeInTheDocument()
    })
  })

  describe('json_object input type', () => {
    it('should render code editor for json_object input', async () => {
      const promptConfig: PromptConfig = {
        prompt_template: 'template',
        prompt_variables: [
          createPromptVariable({
            key: 'jsonInput',
            name: 'JSON Input',
            type: 'json_object' as PromptVariable['type'],
            json_schema: '{"type": "object"}',
          }),
        ],
      }
      const { onInputsChange } = setup({ promptConfig, visionConfig: { ...baseVisionConfig, enabled: false } })
      await waitFor(() => {
        expect(onInputsChange).toHaveBeenCalledWith({
          jsonInput: undefined,
        })
      })
      expect(screen.getByText('JSON Input')).toBeInTheDocument()
      expect(screen.getByTestId('code-editor-mock')).toBeInTheDocument()
    })

    it('should update json_object input when code editor changes', async () => {
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
      const { onInputsChange } = setup({ promptConfig, visionConfig: { ...baseVisionConfig, enabled: false } })
      await waitFor(() => {
        expect(onInputsChange).toHaveBeenCalled()
      })
      onInputsChange.mockClear()

      const codeEditor = screen.getByTestId('code-editor-mock')
      fireEvent.change(codeEditor, { target: { value: '{"key": "value"}' } })

      await waitFor(() => {
        expect(onInputsChange).toHaveBeenCalledWith({
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
      const { onInputsChange } = setup({ promptConfig, visionConfig: { ...baseVisionConfig, enabled: false } })
      await waitFor(() => {
        expect(onInputsChange).toHaveBeenCalled()
      })
      expect(screen.queryByText('Hidden Input')).not.toBeInTheDocument()
      expect(screen.getByText('Visible Input')).toBeInTheDocument()
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
      const { onInputsChange } = setup({ promptConfig, visionConfig: { ...baseVisionConfig, enabled: false } })
      await waitFor(() => {
        expect(onInputsChange).toHaveBeenCalled()
      })
      expect(screen.getByText('workflow.panel.optional')).toBeInTheDocument()
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
      const { onInputsChange } = setup({ promptConfig, visionConfig: { ...baseVisionConfig, enabled: false } })
      await waitFor(() => {
        expect(onInputsChange).toHaveBeenCalled()
      })
      onInputsChange.mockClear()

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.clear' }))

      expect(onInputsChange).toHaveBeenCalledWith({
        selectInput: undefined,
      })
    })
  })

  describe('maxLength behavior', () => {
    it('should not have maxLength attribute when max_length is not set', async () => {
      const promptConfig: PromptConfig = {
        prompt_template: 'template',
        prompt_variables: [
          createPromptVariable({
            key: 'textInput',
            name: 'Text Input',
            type: 'string',
          }),
        ],
      }
      const { onInputsChange } = setup({ promptConfig, visionConfig: { ...baseVisionConfig, enabled: false } })
      await waitFor(() => {
        expect(onInputsChange).toHaveBeenCalled()
      })
      const input = screen.getByPlaceholderText('Text Input')
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
      const { onInputsChange } = setup({ promptConfig, visionConfig: { ...baseVisionConfig, enabled: false } })
      await waitFor(() => {
        expect(onInputsChange).toHaveBeenCalled()
      })
      const input = screen.getByPlaceholderText('Text Input')
      expect(input).toHaveAttribute('maxLength', '100')
    })
  })
})
