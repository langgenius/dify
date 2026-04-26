import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'
import type { HumanInputFormData } from '@/types/workflow'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { UserActionButtonType } from '@/app/components/workflow/nodes/human-input/types'
import { InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'
import HumanInputForm from '../human-input-form'

vi.mock('../content-item', () => ({
  default: ({ content, onInputChange }: { content: string, onInputChange: (name: string, value: unknown) => void }) => (
    <div data-testid="mock-content-item">
      {content}
      <button data-testid="update-input" onClick={() => onInputChange('field1', 'new value')}>Update</button>
      <button data-testid="update-select" onClick={() => onInputChange('field2', 'approved')}>Update Select</button>
      <button
        data-testid="update-single-file"
        onClick={() => onInputChange('field4', {
          id: 'file-2',
          name: 'main.png',
          size: 256,
          type: 'image/png',
          progress: 100,
          transferMethod: TransferMethod.local_file,
          supportFileType: 'image',
          uploadedId: 'upload-file-2',
        })}
      >
        Update Single File
      </button>
      <button
        data-testid="update-pending-single-file"
        onClick={() => onInputChange('field4', {
          id: 'file-2',
          name: 'main.png',
          size: 256,
          type: 'image/png',
          progress: 50,
          transferMethod: TransferMethod.local_file,
          supportFileType: 'image',
        })}
      >
        Update Pending Single File
      </button>
      <button
        data-testid="update-input-file"
        onClick={() => onInputChange('field3', [{
          id: 'file-1',
          name: 'avatar.png',
          size: 128,
          type: 'image/png',
          progress: 100,
          transferMethod: TransferMethod.local_file,
          supportFileType: 'image',
          uploadedId: 'upload-file-1',
        }])}
      >
        Update File
      </button>
      <button
        data-testid="update-pending-input-file"
        onClick={() => onInputChange('field3', [{
          id: 'file-1',
          name: 'avatar.png',
          size: 128,
          type: 'image/png',
          progress: 50,
          transferMethod: TransferMethod.local_file,
          supportFileType: 'image',
        }])}
      >
        Update Pending File
      </button>
    </div>
  ),
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

  it('should render content parts and action buttons', () => {
    render(<HumanInputForm formData={mockFormData} />)

    // splitByOutputVar should yield 3 parts: "Part 1 ", "{{#$output.field1#}}", " Part 2"
    const contentItems = screen.getAllByTestId('mock-content-item')
    expect(contentItems).toHaveLength(3)
    expect(contentItems[0])!.toHaveTextContent('Part 1')
    expect(contentItems[1])!.toHaveTextContent('{{#$output.field1#}}')
    expect(contentItems[2])!.toHaveTextContent('Part 2')

    const buttons = screen.getAllByTestId('action-button')
    expect(buttons).toHaveLength(4)
    expect(buttons[0])!.toHaveTextContent('Submit')
    expect(buttons[1])!.toHaveTextContent('Cancel')
    expect(buttons[2])!.toHaveTextContent('Accent')
    expect(buttons[3])!.toHaveTextContent('Ghost')
  })

  it('should handle input changes and submit correctly', async () => {
    const user = userEvent.setup()
    const mockOnSubmit = vi.fn().mockResolvedValue(undefined)
    render(<HumanInputForm formData={mockFormData} onSubmit={mockOnSubmit} />)

    // Update input via mock ContentItem
    await user.click(screen.getAllByTestId('update-input')[0]!)

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

    await user.click(screen.getAllByTestId('update-input')[0]!)
    await user.click(screen.getAllByTestId('update-input-file')[0]!)
    await user.click(screen.getByRole('button', { name: 'Submit' }))

    expect(mockOnSubmit).toHaveBeenCalledWith('token_123', {
      action: 'action_1',
      inputs: {
        field1: 'new value',
        field3: [{
          type: 'image',
          transfer_method: TransferMethod.local_file,
          url: '',
          upload_file_id: 'upload-file-1',
        }],
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

    render(<HumanInputForm formData={formDataWithRequiredInteractiveFields} onSubmit={mockOnSubmit} />)

    const submitButton = screen.getByRole('button', { name: 'Submit' })
    expect(submitButton).toBeDisabled()

    await user.click(screen.getAllByTestId('update-select')[0]!)
    await user.click(screen.getAllByTestId('update-pending-single-file')[0]!)
    await user.click(screen.getAllByTestId('update-input-file')[0]!)
    expect(submitButton).toBeDisabled()

    await user.click(screen.getAllByTestId('update-single-file')[0]!)
    await user.click(screen.getAllByTestId('update-pending-input-file')[0]!)
    expect(submitButton).toBeDisabled()

    await user.click(screen.getAllByTestId('update-input-file')[0]!)
    expect(submitButton).toBeEnabled()

    await user.click(submitButton)

    expect(mockOnSubmit).toHaveBeenCalledWith('token_123', {
      action: 'action_1',
      inputs: {
        field2: 'approved',
        field3: [{
          type: 'image',
          transfer_method: TransferMethod.local_file,
          url: '',
          upload_file_id: 'upload-file-1',
        }],
        field4: {
          type: 'image',
          transfer_method: TransferMethod.local_file,
          url: '',
          upload_file_id: 'upload-file-2',
        },
      },
    })
  })

  it('should disable buttons during submission', async () => {
    const user = userEvent.setup()
    let resolveSubmit: (value: void | PromiseLike<void>) => void
    const submitPromise = new Promise<void>((resolve) => {
      resolveSubmit = resolve
    })
    const mockOnSubmit = vi.fn().mockReturnValue(submitPromise)

    render(<HumanInputForm formData={mockFormData} onSubmit={mockOnSubmit} />)

    const submitButton = screen.getByRole('button', { name: 'Submit' })
    const cancelButton = screen.getByRole('button', { name: 'Cancel' })

    await user.click(submitButton)

    expect(submitButton)!.toBeDisabled()
    expect(cancelButton)!.toBeDisabled()

    // Finish submission
    await act(async () => {
      resolveSubmit!(undefined)
    })

    expect(submitButton).not.toBeDisabled()
    expect(cancelButton).not.toBeDisabled()
  })

  it('should handle missing resolved_default_values', () => {
    const formDataWithoutDefaults = { ...mockFormData, resolved_default_values: undefined }
    render(<HumanInputForm formData={formDataWithoutDefaults as unknown as HumanInputFormData} />)
    expect(screen.getAllByTestId('mock-content-item')).toHaveLength(3)
  })

  it('should handle mixed supported input types in initializeInputs', () => {
    const formDataWithUnsupported = {
      ...mockFormData,
      inputs: [
        {
          type: InputVarType.select,
          output_variable_name: 'field2',
          option_source: { type: 'variable', value: [], selector: [] },
        } as FormInputItem,
        {
          type: InputVarType.singleFile,
          output_variable_name: 'field3',
          allowed_file_extensions: [],
          allowed_file_types: [],
          allowed_file_upload_methods: [],
        } as FormInputItem,
      ],
      resolved_default_values: { field2: 'default value' },
    }
    render(<HumanInputForm formData={formDataWithUnsupported} />)
    expect(screen.getAllByTestId('mock-content-item')).toHaveLength(3)
  })
})
