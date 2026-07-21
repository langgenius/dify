import type { HumanInputV2FormTransport } from '../types'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HumanInputV2Form from '../form'
import { createMockHumanInputV2FormTransport, HUMAN_INPUT_V2_MOCK_OTP } from '../mock-transport'

const mockPresentation = vi.hoisted(() => ({
  lastDefinition: undefined as unknown,
}))

vi.mock('@/features/human-input-form/loaded-form-content', () => ({
  default: ({
    definition,
    isSubmitting,
    actionsDisabled,
    verificationContent,
    onSubmit,
  }: {
    definition: unknown
    isSubmitting: boolean
    actionsDisabled: boolean
    verificationContent: React.ReactNode
    onSubmit: (inputs: Record<string, unknown>, action: string) => void
  }) => {
    mockPresentation.lastDefinition = definition
    return (
      <div>
        {verificationContent}
        <button
          type="button"
          disabled={isSubmitting || actionsDisabled}
          onClick={() => onSubmit({ response: 'approved' }, 'approve')}
        >
          Approve
        </button>
        <button
          type="button"
          disabled={isSubmitting || actionsDisabled}
          onClick={() => onSubmit({ response: 'rejected' }, 'reject')}
        >
          Reject
        </button>
      </div>
    )
  },
}))

vi.mock('@/features/human-input-form/form-status-card', () => ({
  default: ({
    title,
    subtitle,
    submissionID,
  }: {
    title: React.ReactNode
    subtitle?: React.ReactNode
    submissionID?: string
  }) => (
    <div>
      <div>{title}</div>
      <div>{subtitle}</div>
      {submissionID && <div>{submissionID}</div>}
    </div>
  ),
}))

vi.mock('@/app/components/base/loading', () => ({
  default: () => <div>loading-v2-form</div>,
}))

describe('HumanInputV2Form', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPresentation.lastDefinition = undefined
  })

  it('loads the definition, requests one OTP, validates its shape, and submits one atomic payload', async () => {
    const user = userEvent.setup()
    const transport = createMockHumanInputV2FormTransport()
    const getForm = vi.spyOn(transport, 'getForm')
    const requestAccess = vi.spyOn(transport, 'requestAccess')
    const submit = vi.spyOn(transport, 'submit')

    render(<HumanInputV2Form token="form-token" transport={transport} />)

    expect(screen.getByText('loading-v2-form')).toBeInTheDocument()
    const otpInput = await screen.findByLabelText('share.humanInputV2.otpLabel')
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
    expect(screen.getByText('form-token')).toBeInTheDocument()
    expect(screen.queryByLabelText('share.humanInputV2.otpLabel')).not.toBeInTheDocument()
  })

  it('allows invalid OTP correction while preserving the current challenge', async () => {
    const user = userEvent.setup()
    const transport = createMockHumanInputV2FormTransport()
    const requestAccess = vi.spyOn(transport, 'requestAccess')

    render(<HumanInputV2Form token="form-token" transport={transport} />)
    const otpInput = await screen.findByLabelText('share.humanInputV2.otpLabel')
    await user.type(otpInput, '000000')
    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('share.humanInputV2.invalidOtp')
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
    const baseTransport = createMockHumanInputV2FormTransport()
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

    expect(mockPresentation.lastDefinition).not.toHaveProperty('branding')
  })
})
