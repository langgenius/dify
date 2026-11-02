import type { LegacyHumanInputFormData } from '@/features/human-input/form/types'
import { ORPCError } from '@orpc/client'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

const { mockGetForm, mockSubmitForm, mockUploadLocal, mockUploadRemote } = vi.hoisted(() => ({
  mockGetForm: vi.fn(),
  mockSubmitForm: vi.fn(),
  mockUploadLocal: vi.fn<typeof import('@/service/share').uploadHumanInputFormLocalFile>(),
  mockUploadRemote: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({ useParams: () => ({ token: 'token-123' }) }))
vi.mock('@/service/share', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/share')>()),
  getHumanInputForm: mockGetForm,
  submitHumanInputForm: mockSubmitForm,
  uploadHumanInputFormLocalFile: mockUploadLocal,
  uploadHumanInputFormRemoteFileInfo: mockUploadRemote,
}))

const uploadLocalAttachment = async (user: ReturnType<typeof userEvent.setup>) => {
  // The native file input currently has no accessible label.
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
  await user.upload(input, new File(['review'], 'review.pdf', { type: 'application/pdf' }))
  await waitFor(() => expect(mockUploadLocal).toHaveBeenCalledOnce())
  return mockUploadLocal.mock.calls[0]![0]
}

const completeUpload = async () => {
  await act(async () => {
    mockUploadLocal.mock.calls[0]![0].onSuccessCallback({
      id: 'upload-file-1',
      name: 'review.pdf',
      size: 6,
      mime_type: 'application/pdf',
      extension: 'pdf',
      created_by: 'form-user',
      created_at: 0,
      preview_url: null,
      source_url: '',
    })
  })
}

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
        allowed_file_upload_methods: [TransferMethod.local_file, TransferMethod.remote_url],
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
    mockUploadRemote.mockReset().mockResolvedValue({
      id: 'remote-file',
      name: 'review.pdf',
      mime_type: 'application/pdf',
      size: 6,
      url: 'https://example.com/review.pdf',
    })
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

    await screen.findByRole('textbox', { name: 'summary' })
    await uploadLocalAttachment(user)
    await completeUpload()
    await user.click(screen.getByRole('button', { name: 'common.fileUploader.pasteFileLink' }))
    await user.type(
      screen.getByPlaceholderText('common.fileUploader.pasteFileLinkInputPlaceholder'),
      'https://example.com/review.pdf',
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.ok' }))
    await screen.findByText('https://example.com/review.pdf')

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
    await uploadLocalAttachment(user)
    await user.clear(summary)
    await user.type(summary, 'updated summary')
    await completeUpload()
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
    await uploadLocalAttachment(user)
    await completeUpload()
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

    const upload = await uploadLocalAttachment(user)
    act(() => upload.onProgressCallback(50))
    expect(approve).toBeDisabled()
    await completeUpload()
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
