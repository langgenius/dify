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
      <button type="button" onClick={() => onInputChange('summary', 'updated summary')}>
        update-summary
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
        }])}
      >
        update-attachments
      </button>
    </div>
  ),
}))

describe('SingleRunForm', () => {
  const formData: HumanInputFormData = {
    form_id: 'form-1',
    node_id: 'node-1',
    node_title: 'Human Input',
    form_content: '{{#$output.summary#}} {{#$output.attachments#}}',
    inputs: [
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
        type: InputVarType.multiFiles,
        output_variable_name: 'attachments',
        allowed_file_extensions: ['.pdf'],
        allowed_file_types: [SupportUploadFileTypes.document],
        allowed_file_upload_methods: [TransferMethod.local_file],
        max_upload_count: 3,
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
    await user.click(screen.getAllByRole('button', { name: 'update-attachments' })[0]!)
    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(onSubmit).toHaveBeenCalledWith({
      action: 'approve',
      inputs: {
        summary: 'updated summary',
        attachments: [{
          id: 'file-1',
          name: 'review.pdf',
          size: 128,
          type: 'document',
          progress: 100,
          transferMethod: TransferMethod.local_file,
          supportFileType: 'document',
        } satisfies FileEntity],
      },
    })
  })
})
