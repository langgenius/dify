import type { HumanInputV2FormTransport } from '../types'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createHumanInputV2Error } from '../errors'
import HumanInputV2Form from '../form'
import {
  createHumanInputV2MockScenario,
  createMockHumanInputV2FormTransport,
  HUMAN_INPUT_V2_MOCK_OTP,
} from './fixtures/mock-transport'

vi.mock('@/app/components/base/chat/chat/answer/human-input-content/expiration-time', () => ({
  default: () => null,
}))

const createTransport = (overrides: Partial<HumanInputV2FormTransport> = {}) => {
  const definition = createHumanInputV2MockScenario().definition
  return {
    ...createMockHumanInputV2FormTransport({
      scenario: {
        definition: {
          ...definition,
          formContent: 'Review notes:\n\n{{#$output.response#}}',
          inputs: definition.inputs.slice(0, 1),
        },
        resendAfterSeconds: 0,
      },
    }),
    ...overrides,
  }
}

it('keeps incomplete approval available, identifies the invalid OTP, and submits the real form with Enter', async () => {
  const user = userEvent.setup()
  const transport = createTransport()
  const submit = vi.spyOn(transport, 'submit')
  render(<HumanInputV2Form token="form-token" transport={transport} />)
  const otp = await screen.findByRole('textbox', { name: 'share.humanInputV2.otpLabel' })
  const notes = screen.getByRole('textbox', { name: 'Review notes:' })
  const approve = screen.getByRole('button', { name: 'Approve' })
  expect(approve).toBeEnabled()
  expect(otp.closest('form')).toBe(notes.closest('form'))
  await user.type(otp, '123')
  await user.click(approve)
  expect(await screen.findByRole('alert')).toHaveTextContent('share.humanInputV2.invalidOtp')
  expect(submit).not.toHaveBeenCalled()
  expect(otp).toHaveAccessibleDescription(expect.stringContaining('share.humanInputV2.invalidOtp'))
  await user.clear(otp)
  await user.type(otp, HUMAN_INPUT_V2_MOCK_OTP)
  await user.keyboard('{Enter}')
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith(
      'form-token',
      {
        inputs: { response: 'Looks good' },
        action: 'approve',
        otp_code: HUMAN_INPUT_V2_MOCK_OTP,
        challenge_token: 'mock-challenge-1',
      },
      { signal: expect.any(AbortSignal) },
    ),
  )
  expect(await screen.findByRole('heading', { name: 'share.humanInput.thanks' })).toHaveFocus()
  expect(document.title).toBe('share.humanInput.thanks - Dify')
})

it('shows the clicked action as loading, preserves its focus, and prevents resend during submission', async () => {
  const user = userEvent.setup()
  let complete!: () => void
  const submit = vi.fn<HumanInputV2FormTransport['submit']>(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve
      }),
  )
  render(<HumanInputV2Form token="form-token" transport={createTransport({ submit })} />)
  await user.type(
    await screen.findByRole('textbox', { name: 'share.humanInputV2.otpLabel' }),
    HUMAN_INPUT_V2_MOCK_OTP,
  )
  const reject = screen.getByRole('button', { name: 'Reject' })
  await user.click(reject)
  expect(reject).toHaveFocus()
  expect(reject).toHaveAttribute('aria-disabled', 'true')
  expect(screen.getByRole('button', { name: 'share.humanInputV2.resendCode' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await user.click(screen.getByRole('button', { name: 'Approve' }))
  expect(submit).toHaveBeenCalledTimes(1)
  await act(async () => complete())
  expect(await screen.findByRole('heading', { name: 'share.humanInput.thanks' })).toBeVisible()
})

it('lets the user correct invalid proof in the real OTP and actions composition', async () => {
  const user = userEvent.setup()
  const transport = createTransport()
  const requestAccess = vi.spyOn(transport, 'requestAccess')
  render(<HumanInputV2Form token="form-token" transport={transport} />)
  const otp = await screen.findByRole('textbox', { name: 'share.humanInputV2.otpLabel' })
  await user.type(otp, '000000')
  await user.click(screen.getByRole('button', { name: 'Approve' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('share.humanInputV2.invalidOtp')
  await user.clear(otp)
  await user.type(otp, HUMAN_INPUT_V2_MOCK_OTP)
  await user.click(screen.getByRole('button', { name: 'Reject' }))
  expect(await screen.findByRole('heading', { name: 'share.humanInput.thanks' })).toBeVisible()
  expect(requestAccess).toHaveBeenCalledTimes(1)
})

it('accepts a pasted verification code containing a separator and submits all six digits', async () => {
  const user = userEvent.setup()
  const transport = createTransport()
  const submit = vi.spyOn(transport, 'submit')
  render(<HumanInputV2Form token="pasted-code" transport={transport} />)
  const otp = await screen.findByRole('textbox', { name: 'share.humanInputV2.otpLabel' })
  await user.click(otp)
  await user.paste(`${HUMAN_INPUT_V2_MOCK_OTP.slice(0, 3)} ${HUMAN_INPUT_V2_MOCK_OTP.slice(3)}`)
  expect(otp).toHaveValue(HUMAN_INPUT_V2_MOCK_OTP)
  await user.click(screen.getByRole('button', { name: 'Approve' }))
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith(
      'pasted-code',
      expect.objectContaining({ otp_code: HUMAN_INPUT_V2_MOCK_OTP }),
      { signal: expect.any(AbortSignal) },
    ),
  )
  expect(await screen.findByRole('heading', { name: 'share.humanInput.thanks' })).toBeVisible()
})

it('announces code delivery and keeps a network failure separate from invalid verification proof', async () => {
  const user = userEvent.setup()
  const transport = createTransport({
    submit: vi
      .fn<HumanInputV2FormTransport['submit']>()
      .mockRejectedValue(createHumanInputV2Error('network')),
  })
  render(<HumanInputV2Form token="network-failure" transport={transport} />)
  const otp = await screen.findByRole('textbox', { name: 'share.humanInputV2.otpLabel' })
  expect(screen.getByRole('status')).toHaveTextContent('share.humanInputV2.codeSent')
  await user.type(otp, HUMAN_INPUT_V2_MOCK_OTP)
  await user.click(screen.getByRole('button', { name: 'Approve' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('share.humanInputV2.networkError')
  expect(otp).not.toHaveAttribute('aria-invalid', 'true')
  expect(otp).toHaveValue(HUMAN_INPUT_V2_MOCK_OTP)
})

it.each([
  ['not-found', 'share.humanInputV2.formNotFound'],
  ['expired', 'share.humanInputV2.formExpired'],
  ['submitted', 'share.humanInputV2.alreadySubmitted'],
  ['rate-limited', 'share.humanInputV2.formRateLimited'],
] as const)('does not request proof for a %s form', async (formState, text) => {
  const transport = createMockHumanInputV2FormTransport({ scenario: { formState } })
  const request = vi.spyOn(transport, 'requestAccess')
  render(<HumanInputV2Form token="form-token" transport={transport} />)
  expect(await screen.findByText(text)).toBeVisible()
  expect(document.title).toBe(`${text} - Dify`)
  expect(request).not.toHaveBeenCalled()
})

it.each([
  ['network', 'share.humanInputV2.networkError'],
  ['unavailable', 'share.humanInputV2.unavailable'],
  ['unknown', 'share.humanInputV2.unknownError'],
] as const)('uses the displayed %s error in the browser title', async (category, text) => {
  const getForm = vi
    .fn<HumanInputV2FormTransport['getForm']>()
    .mockRejectedValue(createHumanInputV2Error(category))
  const requestAccess = vi.fn<HumanInputV2FormTransport['requestAccess']>()
  render(
    <HumanInputV2Form
      token="failed-form"
      transport={createTransport({ getForm, requestAccess })}
    />,
  )
  expect(await screen.findByRole('heading', { name: text })).toBeVisible()
  expect(document.title).toBe(`${text} - Dify`)
  expect(requestAccess).not.toHaveBeenCalled()
})

it('uses the verification title while loading and awaiting OTP, preserving configured branding', async () => {
  const transport = createTransport()
  const form = createDeferred<Awaited<ReturnType<HumanInputV2FormTransport['getForm']>>>()
  const definition = await transport.getForm('loading-form')
  const getForm = vi.fn<HumanInputV2FormTransport['getForm']>().mockReturnValue(form.promise)
  render(<HumanInputV2Form token="loading-form" transport={{ ...transport, getForm }} />, {
    systemFeatures: { branding: { enabled: true, application_title: 'Acme' } },
  })
  expect(document.title).toBe('share.humanInputV2.otpLabel - Acme')
  expect(
    screen.queryByRole('textbox', { name: 'share.humanInputV2.otpLabel' }),
  ).not.toBeInTheDocument()
  await act(async () => form.resolve(definition))
  expect(await screen.findByRole('textbox', { name: 'share.humanInputV2.otpLabel' })).toBeVisible()
  expect(document.title).toBe('share.humanInputV2.otpLabel - Acme')
})

it('starts fresh and aborts the previous session when the keyed route changes token', async () => {
  const transport = createTransport()
  const getForm = vi.spyOn(transport, 'getForm')
  const user = userEvent.setup()
  const { rerender } = render(<HumanInputV2Form key="first" token="first" transport={transport} />)
  await user.type(
    await screen.findByRole('textbox', { name: 'share.humanInputV2.otpLabel' }),
    HUMAN_INPUT_V2_MOCK_OTP,
  )
  await user.click(screen.getByRole('button', { name: 'Approve' }))
  await screen.findByRole('heading', { name: 'share.humanInput.thanks' })
  rerender(<HumanInputV2Form key="second" token="second" transport={transport} />)
  expect(await screen.findByRole('textbox', { name: 'share.humanInputV2.otpLabel' })).toHaveValue(
    '',
  )
  expect(getForm.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
  expect(getForm).toHaveBeenLastCalledWith('second', { signal: expect.any(AbortSignal) })
})

it('keeps Send code focused while loading and moves focus to the OTP input when it appears', async () => {
  const user = userEvent.setup()
  const access = createDeferred<Awaited<ReturnType<HumanInputV2FormTransport['requestAccess']>>>()
  const requestAccess = vi
    .fn<HumanInputV2FormTransport['requestAccess']>()
    .mockRejectedValueOnce(new Error('offline'))
    .mockReturnValue(access.promise)
  render(<HumanInputV2Form token="retry-code" transport={createTransport({ requestAccess })} />)
  const send = await screen.findByRole('button', { name: 'share.humanInputV2.sendCode' })
  await user.click(send)
  expect(send).toHaveFocus()
  expect(send).toHaveAttribute('aria-disabled', 'true')
  await act(async () =>
    access.resolve({ challengeToken: 'retried', expiresInSeconds: 600, resendAfterSeconds: 30 }),
  )
  expect(await screen.findByRole('textbox', { name: 'share.humanInputV2.otpLabel' })).toHaveFocus()
})

it('keeps retry focus through another failure and restores focus to verification after recovery', async () => {
  const user = userEvent.setup()
  const base = createTransport()
  const definition = await base.getForm('retry-form')
  const failedRetry = createDeferred<typeof definition>()
  const pending = createDeferred<typeof definition>()
  const getForm = vi
    .fn<HumanInputV2FormTransport['getForm']>()
    .mockRejectedValueOnce(new Error('offline'))
    .mockReturnValueOnce(failedRetry.promise)
    .mockReturnValue(pending.promise)
  render(<HumanInputV2Form token="retry-form" transport={{ ...base, getForm }} />)
  const retry = await screen.findByRole('button', { name: 'share.humanInputV2.retry' })
  expect(document.title).toBe('share.humanInputV2.unknownError - Dify')
  await user.click(retry)
  expect(retry).toHaveFocus()
  expect(retry).toHaveAttribute('aria-disabled', 'true')
  expect(document.title).toBe('share.humanInputV2.unknownError - Dify')
  await act(async () => failedRetry.reject(new Error('still offline')))
  expect(retry).toHaveFocus()
  expect(retry).not.toHaveAttribute('aria-disabled', 'true')
  expect(document.title).toBe('share.humanInputV2.unknownError - Dify')
  await user.click(retry)
  expect(retry).toHaveFocus()
  await act(async () => pending.resolve(definition))
  expect(await screen.findByRole('textbox', { name: 'share.humanInputV2.otpLabel' })).toHaveFocus()
  expect(document.title).toBe('share.humanInputV2.otpLabel - Dify')
})
