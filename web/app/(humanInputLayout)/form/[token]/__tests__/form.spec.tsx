import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { LegacyHumanInputFormData } from '@/features/human-input/form/types'
import { ORPCError } from '@orpc/client'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useFileUploadContext } from '@/app/components/base/file-uploader/upload-context'
import { UserActionButtonType } from '@/app/components/workflow/nodes/human-input/types'
import { InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { TransferMethod } from '@/types/app'
import FormContent from '../form'

const releaseGate = vi.hoisted(() => ({ enabled: true }))
vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  get ENABLE_HITL_IM() {
    return releaseGate.enabled
  },
}))

const { mockGetForm, mockSubmitForm, mockUploadLocal, mockUploadRemote, uploadState } = vi.hoisted(
  () => ({
    mockGetForm: vi.fn(),
    mockSubmitForm: vi.fn(),
    mockUploadLocal: vi.fn(),
    mockUploadRemote: vi.fn(),
    uploadState: { onChange: undefined as ((files: FileEntity[]) => void) | undefined },
  }),
)

vi.mock('@/next/navigation', () => ({ useParams: () => ({ token: 'token-123' }) }))
vi.mock('@/service/share', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/share')>()),
  getHumanInputForm: mockGetForm,
  submitHumanInputForm: mockSubmitForm,
  uploadHumanInputFormLocalFile: mockUploadLocal,
  uploadHumanInputFormRemoteFileInfo: mockUploadRemote,
}))

// Retain the callback captured when upload starts, as the asynchronous uploader does.
// Form parsing, text fields, validation and submission all remain real.
vi.mock('@/app/components/base/file-uploader', () => ({
  FileUploaderInAttachmentWrapper: ({ onChange }: { onChange: (files: FileEntity[]) => void }) => {
    const { uploadStrategy } = useFileUploadContext()
    if (!uploadState.onChange) uploadState.onChange = onChange
    return (
      <div aria-label="Attachment upload">
        <button
          type="button"
          onClick={() =>
            uploadStrategy?.uploadLocal({
              file: new File(['review'], 'review.pdf', { type: 'application/pdf' }),
              onProgressCallback: vi.fn(),
              onSuccessCallback: vi.fn(),
              onErrorCallback: vi.fn(),
            })
          }
        >
          Upload local attachment
        </button>
        <button
          type="button"
          onClick={() => uploadStrategy?.uploadRemote('https://example.com/review.pdf')}
        >
          Upload linked attachment
        </button>
      </div>
    )
  },
}))

const uploadedFile: FileEntity = {
  id: 'file-1',
  name: 'review.pdf',
  size: 128,
  type: 'document',
  progress: 100,
  transferMethod: TransferMethod.local_file,
  supportFileType: SupportUploadFileTypes.document,
  uploadedId: 'upload-file-1',
}
const completeUpload = () => act(() => uploadState.onChange?.([uploadedFile]))

describe.each([false, true])('Human input share form with IM gate %s', (enabled) => {
  const originalTitle = document.title
  afterEach(() => {
    document.title = originalTitle
  })
  const formData: LegacyHumanInputFormData = {
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
        number_limits: 3,
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
    expiration_time: Math.floor(Date.now() / 1000) + 3600,
  }

  beforeEach(() => {
    releaseGate.enabled = enabled
    mockGetForm.mockReset()
    mockSubmitForm.mockReset()
    mockGetForm.mockResolvedValue(formData)
    mockSubmitForm.mockResolvedValue({})
    mockUploadLocal.mockReset().mockResolvedValue(undefined)
    mockUploadRemote.mockReset().mockResolvedValue({ id: 'remote-file' })
    uploadState.onChange = undefined
  })

  it('moves from loading to the requested form and updates its document title', async () => {
    let resolve!: (data: LegacyHumanInputFormData) => void
    mockGetForm.mockReturnValue(
      new Promise<LegacyHumanInputFormData>((done) => {
        resolve = done
      }),
    )
    render(<FormContent />)

    expect(screen.getByLabelText('common.loading')).toBeInTheDocument()
    expect(document.title).toBe('common.loading - Dify')
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()

    await act(async () => resolve(formData))

    expect(await screen.findByRole('textbox', { name: 'summary' })).toHaveValue('initial summary')
    expect(mockGetForm).toHaveBeenCalledExactlyOnceWith('token-123')
    expect(document.title).toBe('Review App - Dify')
    expect(screen.queryByLabelText('common.loading')).not.toBeInTheDocument()
  })

  it('keeps both attachment upload methods scoped to the legacy form token', async () => {
    const user = userEvent.setup()
    render(<FormContent />)

    await user.click(await screen.findByRole('button', { name: 'Upload local attachment' }))
    await user.click(screen.getByRole('button', { name: 'Upload linked attachment' }))

    expect(mockUploadLocal).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        formToken: 'token-123',
        file: expect.any(File),
      }),
    )
    expect(mockUploadRemote).toHaveBeenCalledExactlyOnceWith(
      'token-123',
      'https://example.com/review.pdf',
    )
  })

  it.each([
    {
      code: 'human_input_form_expired',
      title: 'share.humanInput.sorry',
      subtitle: 'share.humanInput.expired',
      submissionID: true,
    },
    {
      code: 'human_input_form_submitted',
      title: 'share.humanInput.sorry',
      subtitle: 'share.humanInput.completed',
      submissionID: true,
    },
    {
      code: 'web_form_rate_limit_exceeded',
      title: 'share.humanInput.rateLimitExceeded',
      subtitle: undefined,
      submissionID: false,
    },
    {
      code: 'not_found',
      title: 'share.humanInput.formNotFound',
      subtitle: undefined,
      submissionID: false,
    },
  ])(
    'shows the terminal status for $code without exposing an editable form',
    async ({ code, title, subtitle, submissionID }) => {
      mockGetForm.mockRejectedValue(new ORPCError(code))
      render(<FormContent />)

      expect(await screen.findByText(title)).toBeInTheDocument()
      if (subtitle) expect(screen.getByText(subtitle)).toBeInTheDocument()
      expect(document.title).toBe(`${subtitle ?? title} - Dify`)
      expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
      if (submissionID)
        expect(
          screen.getByText('share.humanInput.submissionID:{"id":"token-123"}'),
        ).toBeInTheDocument()
      else expect(screen.queryByText(/share.humanInput.submissionID/)).not.toBeInTheDocument()
      expect(screen.getByText('share.chat.poweredBy')).toBeInTheDocument()
    },
  )

  it('preserves edited text when an earlier upload callback completes and submits serialized values', async () => {
    const user = userEvent.setup()
    render(<FormContent />)
    const summary = await screen.findByRole('textbox', { name: 'summary' })
    await user.clear(summary)
    await user.type(summary, 'updated summary')
    completeUpload()
    expect(summary).toHaveValue('updated summary')
    await user.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() =>
      expect(mockSubmitForm).toHaveBeenCalledExactlyOnceWith('token-123', {
        action: 'approve',
        inputs: {
          summary: 'updated summary',
          attachments: [
            {
              type: 'document',
              transfer_method: TransferMethod.local_file,
              url: '',
              upload_file_id: 'upload-file-1',
            },
          ],
        },
      }),
    )
    expect(await screen.findByText('share.humanInput.thanks')).toBeInTheDocument()
    expect(screen.getByText('share.humanInput.recorded')).toBeInTheDocument()
    expect(screen.getByText('share.humanInput.submissionID:{"id":"token-123"}')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'summary' })).not.toBeInTheDocument()
    expect(document.title).toBe('share.humanInput.thanks - Dify')
  })

  it('preserves initialized defaults when upload completes without a text edit', async () => {
    const user = userEvent.setup()
    render(<FormContent />)
    await screen.findByRole('textbox', { name: 'summary' })
    completeUpload()
    await user.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() =>
      expect(mockSubmitForm).toHaveBeenCalledWith(
        'token-123',
        expect.objectContaining({
          inputs: expect.objectContaining({ summary: 'initial summary' }),
        }),
      ),
    )
  })

  it('blocks submission until required text and uploaded files are ready', async () => {
    const user = userEvent.setup()
    render(<FormContent />)
    const approve = await screen.findByRole('button', { name: 'Approve' })
    expect(approve).toBeDisabled()

    act(() => uploadState.onChange?.([{ ...uploadedFile, progress: 50, uploadedId: undefined }]))
    expect(approve).toBeDisabled()
    completeUpload()
    expect(approve).toBeEnabled()
    await user.clear(screen.getByRole('textbox', { name: 'summary' }))
    expect(approve).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: 'summary' }), 'ready')
    expect(approve).toBeEnabled()
    expect(mockSubmitForm).not.toHaveBeenCalled()
  })

  it('hides branding when removal is enabled', async () => {
    mockGetForm.mockResolvedValue({
      ...formData,
      site: { ...formData.site, custom_config: { remove_webapp_brand: true } },
    })
    render(<FormContent />)
    await screen.findByRole('textbox', { name: 'summary' })
    expect(screen.queryByText('share.chat.poweredBy')).not.toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Dify' })).not.toBeInTheDocument()
  })

  it('renders the configured custom branding logo', async () => {
    mockGetForm.mockResolvedValue({
      ...formData,
      site: {
        ...formData.site,
        custom_config: {
          remove_webapp_brand: false,
          replace_webapp_logo: 'https://example.com/custom-logo.png',
        },
      },
    })
    render(<FormContent />)
    expect(await screen.findByRole('img', { name: 'logo' })).toHaveAttribute(
      'src',
      'https://example.com/custom-logo.png',
    )
    expect(screen.getByText('share.chat.poweredBy')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Dify' })).not.toBeInTheDocument()
  })
})
