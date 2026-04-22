import type { FormData } from '../form'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UserActionButtonType } from '@/app/components/workflow/nodes/human-input/types'
import { InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'
import FormContent from '../form'

const mockSubmitForm = vi.hoisted(() => vi.fn())
const mockUseGetHumanInputForm = vi.hoisted(() => vi.fn())

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
  default: ({ content, onInputChange }: { content: string, onInputChange: (name: string, value: unknown) => void }) => (
    <div data-testid="share-form-content-item">
      {content}
      <button type="button" onClick={() => onInputChange('summary', 'updated summary')}>
        share-update-summary
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
        share-update-attachments
      </button>
    </div>
  ),
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
    mockUseGetHumanInputForm.mockReturnValue({
      data: formData,
      isLoading: false,
      error: null,
    })
  })

  it('submits typed human input values through the share form mutation', async () => {
    const user = userEvent.setup()

    render(<FormContent />)

    await user.click(screen.getAllByRole('button', { name: 'share-update-summary' })[0]!)
    await user.click(screen.getAllByRole('button', { name: 'share-update-attachments' })[0]!)
    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(mockSubmitForm).toHaveBeenCalledWith({
      token: 'token-123',
      data: {
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
      },
    }, expect.objectContaining({
      onSuccess: expect.any(Function),
    }))
  })
})
