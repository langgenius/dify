import type { FormData } from '../form'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UserActionButtonType } from '@/app/components/workflow/nodes/human-input/types'
import { InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'
import FormContent from '../form'

const mockSubmitForm = vi.hoisted(() => vi.fn())
const mockUseGetHumanInputForm = vi.hoisted(() => vi.fn())
const mockContentItemState = vi.hoisted(() => ({
  staleAttachmentInputChange: undefined as ((name: string, value: unknown) => void) | undefined,
  uploadedFile: {
    id: 'file-1',
    name: 'review.pdf',
    size: 128,
    type: 'document',
    progress: 100,
    transferMethod: 'local_file',
    supportFileType: 'document',
    uploadedId: 'upload-file-1',
  },
  uploadingFile: {
    id: 'file-1',
    name: 'review.pdf',
    size: 128,
    type: 'document',
    progress: 50,
    transferMethod: 'local_file',
    supportFileType: 'document',
    uploadedId: undefined,
  },
}))

vi.mock('@/next/navigation', () => ({
  useParams: () => ({ token: 'token-123' }),
}))

vi.mock('@/service/use-share', () => ({
  useGetHumanInputForm: (...args: unknown[]) => mockUseGetHumanInputForm(...args),
  useSubmitHumanInputForm: () => ({
    mutate: mockSubmitForm,
    isPending: false,
  }),
}))

vi.mock('@/hooks/use-document-title', () => ({
  __esModule: true,
  default: vi.fn(),
}))

vi.mock('@/app/components/base/chat/chat/answer/human-input-content/content-item', () => ({
  __esModule: true,
  default: ({ content, onInputChange }: { content: string, onInputChange: (name: string, value: unknown) => void }) => {
    const isSummaryField = content.includes('summary')
    const isAttachmentField = content.includes('attachments')

    if (isAttachmentField && !mockContentItemState.staleAttachmentInputChange)
      mockContentItemState.staleAttachmentInputChange = onInputChange

    return (
      <div data-testid="share-form-content-item">
        {content}
        {isSummaryField && (
          <>
            <button type="button" onClick={() => onInputChange('summary', '')}>
              share-clear-summary
            </button>
            <button type="button" onClick={() => onInputChange('summary', 'updated summary')}>
              share-update-summary
            </button>
          </>
        )}
        {isAttachmentField && (
          <>
            <button
              type="button"
              onClick={() => mockContentItemState.staleAttachmentInputChange?.('attachments', [mockContentItemState.uploadingFile])}
            >
              share-uploading-attachments
            </button>
            <button
              type="button"
              onClick={() => mockContentItemState.staleAttachmentInputChange?.('attachments', [mockContentItemState.uploadedFile])}
            >
              share-update-attachments
            </button>
          </>
        )}
      </div>
    )
  },
}))

vi.mock('@/app/components/base/chat/chat/answer/human-input-content/expiration-time', () => ({
  __esModule: true,
  default: () => <div>expiration-time</div>,
}))

vi.mock('@/app/components/base/loading', () => ({
  __esModule: true,
  default: () => <div>loading</div>,
}))

vi.mock('@/app/components/base/logo/dify-logo', () => ({
  __esModule: true,
  default: () => <div>dify-logo</div>,
}))

vi.mock('@/app/components/base/app-icon', () => ({
  __esModule: true,
  default: () => <div>app-icon</div>,
}))

describe('Human input share form', () => {
  const formData: FormData = {
    site: {
      site: {
        title: 'Review App',
        icon_type: 'emoji',
        icon: 'R',
        icon_background: '#fff',
        icon_url: '',
        default_language: 'en-US',
        description: '',
        copyright: '',
        privacy_policy: '',
        custom_disclaimer: '',
        prompt_public: false,
        use_icon_as_answer_icon: false,
      },
    },
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
    resolved_default_values: {},
    user_actions: [
      {
        id: 'approve',
        title: 'Approve',
        button_style: UserActionButtonType.Primary,
      },
    ],
    expiration_time: 60,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockContentItemState.staleAttachmentInputChange = undefined
    mockUseGetHumanInputForm.mockReturnValue({
      data: formData,
      isLoading: false,
      error: null,
    })
  })

  it('submits typed human input values through the share form mutation', async () => {
    const user = userEvent.setup()

    render(<FormContent />)

    await user.click(screen.getByRole('button', { name: 'share-update-summary' }))
    await user.click(screen.getByRole('button', { name: 'share-update-attachments' }))
    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(mockSubmitForm).toHaveBeenCalledWith({
      token: 'token-123',
      data: {
        action: 'approve',
        inputs: {
          summary: 'updated summary',
          attachments: [mockContentItemState.uploadedFile],
        },
      },
    }, expect.objectContaining({
      onSuccess: expect.any(Function),
    }))
  })

  it('should keep initialized defaults when file upload uses the initial change callback', async () => {
    const user = userEvent.setup()

    render(<FormContent />)

    await user.click(screen.getByRole('button', { name: 'share-update-attachments' }))
    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(mockSubmitForm).toHaveBeenCalledWith({
      token: 'token-123',
      data: {
        action: 'approve',
        inputs: {
          summary: 'initial summary',
          attachments: [mockContentItemState.uploadedFile],
        },
      },
    }, expect.objectContaining({
      onSuccess: expect.any(Function),
    }))
  })

  it('should disable action buttons until every required field is filled and files are uploaded', async () => {
    const user = userEvent.setup()

    render(<FormContent />)

    const approveButton = screen.getByRole('button', { name: 'Approve' })
    expect(approveButton).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'share-uploading-attachments' }))
    expect(approveButton).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'share-update-attachments' }))
    expect(approveButton).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'share-clear-summary' }))
    expect(approveButton).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'share-update-summary' }))
    expect(approveButton).toBeEnabled()
  })
})
