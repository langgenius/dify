import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { HumanInputFormData } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'
import { UserActionButtonType } from '../../types'
import SingleRunForm from '../single-run-form'

vi.mock('@/app/components/base/chat/chat/answer/human-input-content/content-item', () => ({
  __esModule: true,
  default: ({ content, onInputChange }: { content: string, onInputChange: (name: string, value: unknown) => void }) => (
    <div data-testid="single-run-content-item">
      {content}
      <button type="button" onClick={() => onInputChange('decision', 'approve')}>
        update-decision
      </button>
      <button type="button" onClick={() => onInputChange('summary', 'updated summary')}>
        update-summary
      </button>
      <button
        type="button"
        onClick={() => onInputChange('attachment', {
          id: 'file-0',
          name: 'main.pdf',
          size: 64,
          type: 'document',
          progress: 100,
          transferMethod: TransferMethod.local_file,
          supportFileType: 'document',
          uploadedId: 'upload-file-0',
        })}
      >
        update-attachment
      </button>
      <button
        type="button"
        onClick={() => onInputChange('attachment', {
          id: 'file-0',
          name: 'main.pdf',
          size: 64,
          type: 'document',
          progress: 50,
          transferMethod: TransferMethod.local_file,
          supportFileType: 'document',
        })}
      >
        update-pending-attachment
      </button>
      <button
        type="button"
        onClick={() => onInputChange('attachments', [{
          id: 'file-1',
          name: 'review.pdf',
          size: 128,
          type: 'document',
          progress: 100,
          transferMethod: TransferMethod.local_file,
          supportFileType: 'document',
          uploadedId: 'upload-file-1',
        }])}
      >
        update-attachments
      </button>
      <button
        type="button"
        onClick={() => onInputChange('attachments', [{
          id: 'file-1',
          name: 'review.pdf',
          size: 128,
          type: 'document',
          progress: 50,
          transferMethod: TransferMethod.local_file,
          supportFileType: 'document',
        }])}
      >
        update-pending-attachments
      </button>
    </div>
  ),
}))

describe('SingleRunForm', () => {
  const formData: HumanInputFormData = {
    form_id: 'form-1',
    node_id: 'node-1',
    node_title: 'Human Input',
    form_content: '{{#$output.decision#}} {{#$output.summary#}} {{#$output.attachment#}} {{#$output.attachments#}}',
    inputs: [
      {
        type: InputVarType.select,
        output_variable_name: 'decision',
        option_source: {
          type: 'constant',
          value: ['approve', 'reject'],
          selector: [],
        },
      },
      {
        type: InputVarType.paragraph,
        output_variable_name: 'summary',
        default: {
          type: 'constant',
          value: 'initial summary',
          selector: [],
        },
      },
      {
        type: InputVarType.singleFile,
        output_variable_name: 'attachment',
        allowed_file_extensions: ['.pdf'],
        allowed_file_types: [SupportUploadFileTypes.document],
        allowed_file_upload_methods: [TransferMethod.local_file],
      },
      {
        type: InputVarType.multiFiles,
        output_variable_name: 'attachments',
        allowed_file_extensions: ['.pdf'],
        allowed_file_types: [SupportUploadFileTypes.document],
        allowed_file_upload_methods: [TransferMethod.local_file],
        number_limits: 3,
      },
    ],
    actions: [
      {
        id: 'approve',
        title: 'Approve',
        button_style: UserActionButtonType.Primary,
      },
    ],
    form_token: 'token-1',
    resolved_default_values: {},
    display_in_ui: true,
    expiration_time: 0,
  }

  it('submits typed human input values from the single-run form', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)

    render(
      <SingleRunForm
        nodeName="Human Input"
        data={formData}
        onSubmit={onSubmit}
      />,
    )

    await user.click(screen.getAllByRole('button', { name: 'update-summary' })[0]!)
    await user.click(screen.getAllByRole('button', { name: 'update-decision' })[0]!)
    await user.click(screen.getAllByRole('button', { name: 'update-attachment' })[0]!)
    await user.click(screen.getAllByRole('button', { name: 'update-attachments' })[0]!)
    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(onSubmit).toHaveBeenCalledWith({
      action: 'approve',
      inputs: {
        decision: 'approve',
        summary: 'updated summary',
        attachment: {
          id: 'file-0',
          name: 'main.pdf',
          size: 64,
          type: 'document',
          progress: 100,
          transferMethod: TransferMethod.local_file,
          supportFileType: 'document',
          uploadedId: 'upload-file-0',
        } satisfies FileEntity,
        attachments: [{
          id: 'file-1',
          name: 'review.pdf',
          size: 128,
          type: 'document',
          progress: 100,
          transferMethod: TransferMethod.local_file,
          supportFileType: 'document',
          uploadedId: 'upload-file-1',
        } satisfies FileEntity],
      },
    })
  })

  it('disables action buttons until select, file, and file list fields have values', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)

    render(
      <SingleRunForm
        nodeName="Human Input"
        data={formData}
        onSubmit={onSubmit}
      />,
    )

    const actionButton = screen.getByRole('button', { name: 'Approve' })
    expect(actionButton).toBeDisabled()

    await user.click(screen.getAllByRole('button', { name: 'update-decision' })[0]!)
    expect(actionButton).toBeDisabled()

    await user.click(screen.getAllByRole('button', { name: 'update-attachment' })[0]!)
    expect(actionButton).toBeDisabled()

    await user.click(screen.getAllByRole('button', { name: 'update-attachments' })[0]!)
    expect(actionButton).toBeEnabled()

    await user.click(actionButton)

    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('keeps action buttons disabled while selected files are still uploading', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)

    render(
      <SingleRunForm
        nodeName="Human Input"
        data={formData}
        onSubmit={onSubmit}
      />,
    )

    const actionButton = screen.getByRole('button', { name: 'Approve' })

    await user.click(screen.getAllByRole('button', { name: 'update-decision' })[0]!)
    await user.click(screen.getAllByRole('button', { name: 'update-pending-attachment' })[0]!)
    await user.click(screen.getAllByRole('button', { name: 'update-attachments' })[0]!)
    expect(actionButton).toBeDisabled()

    await user.click(screen.getAllByRole('button', { name: 'update-attachment' })[0]!)
    await user.click(screen.getAllByRole('button', { name: 'update-pending-attachments' })[0]!)
    expect(actionButton).toBeDisabled()

    await user.click(screen.getAllByRole('button', { name: 'update-attachments' })[0]!)
    expect(actionButton).toBeEnabled()
  })
})
