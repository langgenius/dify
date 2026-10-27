import type { ComponentProps } from 'react'
import type { FileUploaderInAttachmentWrapper } from '@/app/components/base/file-uploader'
import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'
import type { HumanInputFormData } from '@/types/workflow'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
import { UserActionButtonType } from '@/app/components/workflow/nodes/human-input/types'
import { InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
import { createDeferred } from '@/test/deferred'
import { TransferMethod } from '@/types/app'
import HumanInputForm from '../human-input-form'

vi.mock('@/app/components/base/file-uploader', () => ({
  FileUploaderInAttachmentWrapper: ({
    onChange,
    fileConfig,
  }: ComponentProps<typeof FileUploaderInAttachmentWrapper>) => {
    const single = fileConfig.number_limits === 1
    const update = (progress: number) =>
      onChange([
        {
          id: single ? 'file-2' : 'file-1',
          name: single ? 'main.png' : 'avatar.png',
          size: 128,
          type: 'image/png',
          progress,
          transferMethod: TransferMethod.local_file,
          supportFileType: SupportUploadFileTypes.image,
          uploadedId: progress === 100 ? (single ? 'upload-file-2' : 'upload-file-1') : undefined,
        },
      ])
    return (
      <>
        <button onClick={() => update(50)}>
          {single ? 'Upload single file' : 'Upload file list'}
        </button>
        <button onClick={() => update(100)}>
          {single ? 'Finish single file' : 'Finish file list'}
        </button>
      </>
    )
  },
}))

describe('HumanInputForm', () => {
  const mockFormData: HumanInputFormData = {
    form_id: 'form_1',
    node_id: 'node_1',
    node_title: 'Title',
    display_in_ui: true,
    expiration_time: 0,
    form_token: 'token_123',
    form_content: 'Part 1 {{#$output.field1#}} Part 2',
    inputs: [
      {
        type: 'paragraph',
        output_variable_name: 'field1',
        default: { type: 'constant', value: 'initial', selector: [] },
      } as FormInputItem,
    ],
    actions: [
      { id: 'action_1', title: 'Submit', button_style: UserActionButtonType.Primary },
      { id: 'action_2', title: 'Cancel', button_style: UserActionButtonType.Default },
      { id: 'action_3', title: 'Accent', button_style: UserActionButtonType.Accent },
      { id: 'action_4', title: 'Ghost', button_style: UserActionButtonType.Ghost },
    ],
    resolved_default_values: {},
  }

  it('should handle input changes and submit correctly', async () => {
    const user = userEvent.setup()
    const mockOnSubmit = vi.fn().mockResolvedValue(undefined)
    render(<HumanInputForm formData={mockFormData} onSubmit={mockOnSubmit} />)

    const input = screen.getByRole('textbox', { name: 'field1' })
    await user.clear(input)
    await user.type(input, 'new value')

    // Submit
    const submitButton = screen.getByRole('button', { name: 'Submit' })
    await user.click(submitButton)

    expect(mockOnSubmit).toHaveBeenCalledWith('token_123', {
      action: 'action_1',
      inputs: { field1: 'new value' },
    })
  })

  it('should submit file field values using the backend payload shape', async () => {
    const user = userEvent.setup()
    const mockOnSubmit = vi.fn().mockResolvedValue(undefined)
    const formDataWithFileList: HumanInputFormData = {
      ...mockFormData,
      form_content: '{{#$output.field1#}} {{#$output.field3#}}',
      inputs: [
        {
          type: InputVarType.paragraph,
          output_variable_name: 'field1',
          default: { type: 'constant', value: 'initial', selector: [] },
        },
        {
          type: InputVarType.multiFiles,
          output_variable_name: 'field3',
          allowed_file_extensions: ['.png'],
          allowed_file_types: [SupportUploadFileTypes.image],
          allowed_file_upload_methods: [TransferMethod.local_file],
          number_limits: 5,
        },
      ] as FormInputItem[],
    }

    render(<HumanInputForm formData={formDataWithFileList} onSubmit={mockOnSubmit} />)

    const input = screen.getByRole('textbox', { name: 'field1' })
    await user.clear(input)
    await user.type(input, 'new value')
    await user.click(screen.getByRole('button', { name: 'Finish file list' }))
    await user.click(screen.getByRole('button', { name: 'Submit' }))

    expect(mockOnSubmit).toHaveBeenCalledWith('token_123', {
      action: 'action_1',
      inputs: {
        field1: 'new value',
        field3: [
          {
            type: 'image',
            transfer_method: TransferMethod.local_file,
            url: '',
            upload_file_id: 'upload-file-1',
          },
        ],
      },
    })
  })

  it('should disable buttons until select, file, and file list inputs have uploaded values', async () => {
    const user = userEvent.setup()
    const mockOnSubmit = vi.fn().mockResolvedValue(undefined)
    const formDataWithRequiredInteractiveFields: HumanInputFormData = {
      ...mockFormData,
      form_content: '{{#$output.field2#}} {{#$output.field3#}} {{#$output.field4#}}',
      inputs: [
        {
          type: InputVarType.select,
          output_variable_name: 'field2',
          option_source: {
            type: 'constant',
            value: ['approved'],
            selector: [],
          },
        },
        {
          type: InputVarType.multiFiles,
          output_variable_name: 'field3',
          allowed_file_extensions: ['.png'],
          allowed_file_types: [SupportUploadFileTypes.image],
          allowed_file_upload_methods: [TransferMethod.local_file],
          number_limits: 5,
        },
        {
          type: InputVarType.singleFile,
          output_variable_name: 'field4',
          allowed_file_extensions: ['.png'],
          allowed_file_types: [SupportUploadFileTypes.image],
          allowed_file_upload_methods: [TransferMethod.local_file],
        },
      ] as FormInputItem[],
    }

    render(
      <HumanInputForm formData={formDataWithRequiredInteractiveFields} onSubmit={mockOnSubmit} />,
    )

    const submitButton = screen.getByRole('button', { name: 'Submit' })
    expect(submitButton).toBeDisabled()

    await user.click(screen.getByRole('combobox', { name: 'field2' }))
    await user.click(screen.getByRole('option', { name: 'approved' }))
    await user.click(screen.getByRole('button', { name: 'Upload single file' }))
    await user.click(screen.getByRole('button', { name: 'Finish file list' }))
    expect(submitButton).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Finish single file' }))
    await user.click(screen.getByRole('button', { name: 'Upload file list' }))
    expect(submitButton).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Finish file list' }))
    expect(submitButton).toBeEnabled()

    await user.click(submitButton)

    expect(mockOnSubmit).toHaveBeenCalledWith('token_123', {
      action: 'action_1',
      inputs: {
        field2: 'approved',
        field3: [
          {
            type: 'image',
            transfer_method: TransferMethod.local_file,
            url: '',
            upload_file_id: 'upload-file-1',
          },
        ],
        field4: {
          type: 'image',
          transfer_method: TransferMethod.local_file,
          url: '',
          upload_file_id: 'upload-file-2',
        },
      },
    })
  })

  it('should ignore input fields that are not rendered in form content when checking actions', async () => {
    const user = userEvent.setup()
    const mockOnSubmit = vi.fn().mockResolvedValue(undefined)
    const formDataWithStaleInput: HumanInputFormData = {
      ...mockFormData,
      form_content: '{{#$output.field2#}}',
      inputs: [
        {
          type: InputVarType.select,
          output_variable_name: 'field2',
          option_source: {
            type: 'constant',
            value: ['approved'],
            selector: [],
          },
        },
        {
          type: InputVarType.select,
          output_variable_name: 'stale_select',
          option_source: {
            type: 'constant',
            value: ['unused'],
            selector: [],
          },
        },
        {
          type: InputVarType.singleFile,
          output_variable_name: 'stale_file',
          allowed_file_extensions: ['.png'],
          allowed_file_types: [SupportUploadFileTypes.image],
          allowed_file_upload_methods: [TransferMethod.local_file],
        },
      ] as FormInputItem[],
    }

    render(<HumanInputForm formData={formDataWithStaleInput} onSubmit={mockOnSubmit} />)

    const submitButton = screen.getByRole('button', { name: 'Submit' })
    expect(submitButton).toBeDisabled()

    expect(screen.queryByRole('combobox', { name: 'stale_select' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: 'field2' }))
    await user.click(screen.getByRole('option', { name: 'approved' }))
    expect(submitButton).toBeEnabled()

    await user.click(submitButton)

    expect(mockOnSubmit).toHaveBeenCalledWith('token_123', {
      action: 'action_1',
      inputs: {
        field2: 'approved',
      },
    })
  })

  it('should disable buttons during submission', async () => {
    const user = userEvent.setup()
    const pending = createDeferred()
    const mockOnSubmit = vi.fn().mockReturnValue(pending.promise)

    render(<HumanInputForm formData={mockFormData} onSubmit={mockOnSubmit} />)

    const submitButton = screen.getByRole('button', { name: 'Submit' })
    const cancelButton = screen.getByRole('button', { name: 'Cancel' })

    await user.click(submitButton)

    expect(submitButton).toBeDisabled()
    expect(cancelButton).toBeDisabled()

    // Finish submission
    await act(async () => {
      pending.resolve()
    })

    expect(submitButton).not.toBeDisabled()
    expect(cancelButton).not.toBeDisabled()
  })

  it('keeps entered values and allows retrying after a failed submission', async () => {
    const user = userEvent.setup()
    const pending = createDeferred()
    const onSubmit = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(undefined)
    render(<HumanInputForm formData={mockFormData} onSubmit={onSubmit} />)
    const input = screen.getByRole('textbox', { name: 'field1' })
    await user.clear(input)
    await user.type(input, 'Keep this response')
    const submit = screen.getByRole('button', { name: 'Submit' })
    await user.click(submit)
    expect(submit).toBeDisabled()
    await act(async () => pending.reject(new Error('Request failed')))
    await waitFor(() => expect(submit).toBeEnabled())
    expect(input).toHaveValue('Keep this response')
    await user.click(submit)
    expect(onSubmit).toHaveBeenCalledTimes(2)
    expect(onSubmit).toHaveBeenLastCalledWith('token_123', {
      action: 'action_1',
      inputs: { field1: 'Keep this response' },
    })
  })
})
