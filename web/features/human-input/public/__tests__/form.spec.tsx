import type { HumanInputV2FormTransport } from '../types'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import HumanInputV2Form from '../form'
import {
  createHumanInputV2MockScenario,
  createMockHumanInputV2FormTransport,
  HUMAN_INPUT_V2_MOCK_OTP,
} from '../mock-transport'

vi.mock('@/next/navigation', () => ({ useParams: () => ({}) }))

// OTP scenarios use a supported text-only definition; the upload/navigation
// scenario below retains the attachment definition.
const createTextFormTransport = () => {
  const { definition } = createHumanInputV2MockScenario()
  return createMockHumanInputV2FormTransport({
    scenario: {
      definition: {
        ...definition,
        formContent: '{{#$output.response#}}',
        inputs: definition.inputs.filter((input) => input.output_variable_name === 'response'),
      },
    },
  })
}

describe('HumanInputV2Form', () => {
  it('loads the definition, requests one OTP, validates its shape, and submits one atomic payload', async () => {
    const user = userEvent.setup()
    const transport = createTextFormTransport()
    const getForm = vi.spyOn(transport, 'getForm')
    const requestAccess = vi.spyOn(transport, 'requestAccess')
    const submit = vi.spyOn(transport, 'submit')

    render(<HumanInputV2Form token="form-token" transport={transport} />)

    expect(screen.getByLabelText('common.loading')).toBeInTheDocument()
    const otpInput = await screen.findByLabelText('share.humanInputV2.otpLabel')
    const response = screen.getByRole('textbox', { name: 'response' })
    await user.clear(response)
    await user.type(response, 'approved')
    const approve = screen.getByRole('button', { name: 'Approve' })
    expect(getForm).toHaveBeenCalledWith('form-token')
    expect(requestAccess).toHaveBeenCalledTimes(1)
    expect(approve).toBeDisabled()
    expect(otpInput).toHaveAttribute('autocomplete', 'one-time-code')

    await user.type(otpInput, '24681')
    expect(approve).toBeDisabled()
    await user.type(otpInput, '0')
    expect(approve).toBeEnabled()
    await user.click(approve)

    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith('form-token', {
        inputs: { response: 'approved' },
        action: 'approve',
        otp_code: HUMAN_INPUT_V2_MOCK_OTP,
        challenge_token: 'mock-challenge-1',
      }),
    )
    expect(await screen.findByText('share.humanInput.thanks')).toBeInTheDocument()
    expect(
      screen.getByText('share.humanInput.submissionID:{"id":"form-token"}'),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('share.humanInputV2.otpLabel')).not.toBeInTheDocument()
  })

  it('allows invalid OTP correction while preserving the current challenge', async () => {
    const user = userEvent.setup()
    const transport = createTextFormTransport()
    const requestAccess = vi.spyOn(transport, 'requestAccess')

    render(<HumanInputV2Form token="form-token" transport={transport} />)
    const otpInput = await screen.findByLabelText('share.humanInputV2.otpLabel')
    await user.type(otpInput, '000000')
    await user.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() => expect(otpInput).toHaveFocus())
    expect(otpInput).toHaveAccessibleDescription('share.humanInputV2.invalidOtp')
    expect(otpInput).toHaveAttribute('aria-invalid', 'true')
    expect(requestAccess).toHaveBeenCalledTimes(1)
    expect(otpInput).toHaveValue('000000')

    await user.clear(otpInput)
    await user.type(otpInput, HUMAN_INPUT_V2_MOCK_OTP)
    await user.click(screen.getByRole('button', { name: 'Approve' }))
    expect(await screen.findByText('share.humanInput.thanks')).toBeInTheDocument()
  })

  it('locks every action while a submit is pending', async () => {
    const user = userEvent.setup()
    let resolveSubmit!: () => void
    const submitPromise = new Promise<void>((resolve) => {
      resolveSubmit = resolve
    })
    const baseTransport = createTextFormTransport()
    const submit = vi.fn<HumanInputV2FormTransport['submit']>().mockReturnValue(submitPromise)
    const transport = { ...baseTransport, submit }

    render(<HumanInputV2Form token="form-token" transport={transport} />)
    const otpInput = await screen.findByLabelText('share.humanInputV2.otpLabel')
    await user.type(otpInput, HUMAN_INPUT_V2_MOCK_OTP)
    const approve = screen.getByRole('button', { name: 'Approve' })
    const reject = screen.getByRole('button', { name: 'Reject' })
    await user.click(approve)

    expect(approve).toBeDisabled()
    expect(reject).toBeDisabled()
    await user.click(reject)
    expect(submit).toHaveBeenCalledTimes(1)

    await act(async () => resolveSubmit())
  })

  it.each([
    ['not-found', 'share.humanInputV2.formNotFound'],
    ['expired', 'share.humanInputV2.formExpired'],
    ['submitted', 'share.humanInputV2.alreadySubmitted'],
    ['rate-limited', 'share.humanInputV2.formRateLimited'],
  ] as const)(
    'renders the %s terminal form state without requesting access',
    async (formState, copy) => {
      const transport = createMockHumanInputV2FormTransport({ scenario: { formState } })
      const requestAccess = vi.spyOn(transport, 'requestAccess')

      render(<HumanInputV2Form token="form-token" transport={transport} />)

      expect(await screen.findByText(copy)).toBeInTheDocument()
      if (formState === 'expired' || formState === 'submitted') {
        expect(screen.getByText('share.humanInput.sorry')).toBeInTheDocument()
        expect(
          screen.getByText('share.humanInput.submissionID:{"id":"form-token"}'),
        ).toBeInTheDocument()
      }
      expect(requestAccess).not.toHaveBeenCalled()
      expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    },
  )

  it('renders and retries a recoverable unavailable definition state', async () => {
    const baseTransport = createMockHumanInputV2FormTransport()
    const getForm = vi
      .fn<HumanInputV2FormTransport['getForm']>()
      .mockRejectedValueOnce({ code: 'human_input_v2_unavailable' })
      .mockImplementation(baseTransport.getForm)
    const transport = { ...baseTransport, getForm }
    const user = userEvent.setup()

    render(<HumanInputV2Form token="form-token" transport={transport} />)
    expect(await screen.findByText('share.humanInputV2.unavailable')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'share.humanInputV2.retry' }))

    expect(await screen.findByLabelText('share.humanInputV2.otpLabel')).toBeInTheDocument()
    expect(getForm).toHaveBeenCalledTimes(2)
  })

  it('renders a neutral no-branding definition through shared presentation', async () => {
    const transport = createMockHumanInputV2FormTransport()

    render(<HumanInputV2Form token="form-token" transport={transport} />)
    await screen.findByLabelText('share.humanInputV2.otpLabel')

    expect(screen.getByRole('textbox', { name: 'response' })).toHaveValue('Looks good')
    expect(screen.getByText('share.chat.poweredBy')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Dify' })).toBeInTheDocument()
  })

  it('scopes attachment uploads to the displayed token and injected transport after navigation', async () => {
    const user = userEvent.setup()
    const transport = createMockHumanInputV2FormTransport()
    const uploadLocalFile = vi.spyOn(transport, 'uploadLocalFile')
    const uploadRemoteFile = vi.spyOn(transport, 'uploadRemoteFile').mockResolvedValue({
      id: 'remote-2',
      name: 'review.txt',
      mimeType: 'text/plain',
      size: 6,
      url: 'https://example.com/review.txt',
    })
    const { rerender } = render(<HumanInputV2Form token="first-form" transport={transport} />)

    await screen.findByRole('textbox', { name: 'response' })
    // The native chooser has no accessible label in the current uploader.
    await user.upload(
      document.querySelector<HTMLInputElement>('input[type="file"]')!,
      new File(['review'], 'review.txt', { type: 'text/plain' }),
    )
    await screen.findByText('review.txt')
    await waitFor(() => expect(uploadLocalFile).toHaveBeenCalledOnce())
    expect(uploadLocalFile).toHaveBeenCalledWith('first-form', expect.any(File))

    rerender(<HumanInputV2Form token="second-form" transport={transport} />)
    await waitFor(() => expect(screen.queryByText('review.txt')).not.toBeInTheDocument())
    await user.click(
      await screen.findByRole('button', { name: 'common.fileUploader.pasteFileLink' }),
    )
    await user.type(
      screen.getByPlaceholderText('common.fileUploader.pasteFileLinkInputPlaceholder'),
      'https://example.com/review.txt',
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.ok' }))
    await screen.findByText('https://example.com/review.txt')
    await waitFor(() => expect(uploadRemoteFile).toHaveBeenCalledOnce())
    expect(uploadRemoteFile).toHaveBeenCalledWith('second-form', 'https://example.com/review.txt')
  })
})
