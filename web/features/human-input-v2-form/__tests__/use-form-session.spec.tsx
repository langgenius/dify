import type { PropsWithChildren } from 'react'
import type { HumanInputV2FormTransport } from '../types'
import { act, renderHook, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { createHumanInputV2Error } from '../errors'
import {
  createHumanInputV2MockScenario,
  createMockHumanInputV2FormTransport,
  HUMAN_INPUT_V2_MOCK_OTP,
} from '../mock-transport'
import { useHumanInputV2FormSession } from '../use-form-session'

const strictWrapper = ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>

const deferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const withOverrides = (
  overrides: Partial<HumanInputV2FormTransport>,
): HumanInputV2FormTransport => ({
  ...createMockHumanInputV2FormTransport(),
  ...overrides,
})

describe('useHumanInputV2FormSession', () => {
  it('requests access exactly once in Strict Mode across rerenders, input changes, and browser events', async () => {
    const transport = createMockHumanInputV2FormTransport()
    const getForm = vi.spyOn(transport, 'getForm')
    const requestAccess = vi.spyOn(transport, 'requestAccess')
    const { result, rerender } = renderHook(
      () => useHumanInputV2FormSession({ token: 'form-token', transport }),
      { wrapper: strictWrapper },
    )

    await waitFor(() => expect(result.current.state.phase).toBe('awaiting-otp'))
    act(() => result.current.setOtpCode('123456'))
    rerender()
    act(() => {
      window.dispatchEvent(new Event('focus'))
      window.dispatchEvent(new Event('online'))
    })

    expect(getForm).toHaveBeenCalledTimes(1)
    expect(requestAccess).toHaveBeenCalledTimes(1)
  })

  it('does not auto-request access after a definition or terminal failure', async () => {
    const requestAccess = vi.fn<HumanInputV2FormTransport['requestAccess']>()
    const transport = withOverrides({
      getForm: vi
        .fn()
        .mockRejectedValue(createHumanInputV2Error('not-found', 'human_input_form_not_found', 404)),
      requestAccess,
    })
    const { result } = renderHook(() =>
      useHumanInputV2FormSession({
        token: 'missing-token',
        transport,
      }),
    )

    await waitFor(() => expect(result.current.state.phase).toBe('terminal'))
    expect(requestAccess).not.toHaveBeenCalled()
  })

  it('supports an explicit access retry after the automatic attempt fails', async () => {
    const requestAccess = vi
      .fn<HumanInputV2FormTransport['requestAccess']>()
      .mockRejectedValueOnce(createHumanInputV2Error('access-delivery-failed'))
      .mockResolvedValueOnce({
        challengeToken: 'challenge-retry',
        resendAfterSeconds: 30,
        expiresInSeconds: 300,
      })
    const transport = withOverrides({ requestAccess })
    const { result } = renderHook(() =>
      useHumanInputV2FormSession({
        token: 'form-token',
        transport,
      }),
    )

    await waitFor(() => expect(result.current.state.phase).toBe('access-error'))
    expect(requestAccess).toHaveBeenCalledTimes(1)

    act(() => result.current.retryAccess())
    await waitFor(() => expect(result.current.state.phase).toBe('awaiting-otp'))
    expect(requestAccess).toHaveBeenCalledTimes(2)
  })

  it('derives absolute cooldown/expiry deadlines and never auto-resends after expiry', async () => {
    vi.useFakeTimers()
    let currentTime = 10_000
    const now = () => currentTime
    const transport = createMockHumanInputV2FormTransport({
      now,
      scenario: { resendAfterSeconds: 10, expiresInSeconds: 20 },
    })
    const requestAccess = vi.spyOn(transport, 'requestAccess')
    const submit = vi.spyOn(transport, 'submit')
    const { result } = renderHook(() =>
      useHumanInputV2FormSession({
        token: 'form-token',
        transport,
        now,
      }),
    )
    await act(async () => Promise.resolve())
    await act(async () => Promise.resolve())
    expect(result.current.state.phase).toBe('awaiting-otp')
    expect(result.current.secondsUntilResend).toBe(10)
    expect(result.current.secondsUntilExpiry).toBe(20)

    currentTime += 20_000
    act(() => window.dispatchEvent(new Event('focus')))

    expect(result.current.state.phase).toBe('challenge-expired')
    expect(result.current.state.challenge).toBeUndefined()
    expect(requestAccess).toHaveBeenCalledTimes(1)
    await act(async () => result.current.submit({}, 'approve'))
    expect(submit).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('replaces proof on resend and preserves an older unexpired challenge on transient failure', async () => {
    let currentTime = 1_000
    const now = () => currentTime
    const firstTransport = createMockHumanInputV2FormTransport({
      now,
      scenario: { resendAfterSeconds: 5, expiresInSeconds: 60 },
    })
    const { result } = renderHook(() =>
      useHumanInputV2FormSession({
        token: 'form-token',
        transport: firstTransport,
        now,
      }),
    )
    await waitFor(() => expect(result.current.state.phase).toBe('awaiting-otp'))
    const firstChallenge = result.current.state.challenge!.challengeToken
    act(() => result.current.setOtpCode('123456'))

    currentTime += 5_000
    act(() => result.current.resendAccess())
    await waitFor(() => {
      expect(result.current.state.challenge?.challengeToken).not.toBe(firstChallenge)
    })
    expect(result.current.state.otpCode).toBe('')

    const previousChallenge = result.current.state.challenge
    const requestAccess = vi
      .fn<HumanInputV2FormTransport['requestAccess']>()
      .mockRejectedValue(createHumanInputV2Error('network'))
    const failingTransport = withOverrides({ requestAccess })
    const { result: failingResult } = renderHook(() =>
      useHumanInputV2FormSession({
        token: 'second-token',
        transport: failingTransport,
        now,
      }),
    )
    await waitFor(() => expect(failingResult.current.state.phase).toBe('access-error'))

    requestAccess.mockResolvedValueOnce({
      challengeToken: previousChallenge!.challengeToken,
      resendAfterSeconds: 0,
      expiresInSeconds: 60,
    })
    act(() => failingResult.current.retryAccess())
    await waitFor(() => expect(failingResult.current.state.challenge).toBeDefined())
    const challengeBeforeFailure = failingResult.current.state.challenge
    requestAccess.mockRejectedValueOnce(createHumanInputV2Error('network'))
    act(() => failingResult.current.resendAccess())
    await waitFor(() => expect(failingResult.current.state.error).toBe('network'))
    expect(failingResult.current.state.challenge).toEqual(challengeBeforeFailure)
  })

  it('submits an atomic payload once and clears proof on success', async () => {
    const submitDeferred = deferred<void>()
    const submit = vi
      .fn<HumanInputV2FormTransport['submit']>()
      .mockReturnValue(submitDeferred.promise)
    const transport = withOverrides({ submit })
    const { result } = renderHook(() =>
      useHumanInputV2FormSession({
        token: 'form-token',
        transport,
      }),
    )
    await waitFor(() => expect(result.current.state.phase).toBe('awaiting-otp'))
    act(() => result.current.setOtpCode(HUMAN_INPUT_V2_MOCK_OTP))
    await waitFor(() => expect(result.current.canSubmit).toBe(true))

    act(() => {
      void result.current.submit({ response: 'approved' }, 'approve')
      void result.current.submit({ response: 'rejected' }, 'reject')
    })

    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit).toHaveBeenCalledWith('form-token', {
      inputs: { response: 'approved' },
      action: 'approve',
      otp_code: HUMAN_INPUT_V2_MOCK_OTP,
      challenge_token: 'mock-challenge-1',
    })

    await act(async () => submitDeferred.resolve())
    expect(result.current.state).toMatchObject({ phase: 'success', otpCode: '' })
    expect(result.current.state.challenge).toBeUndefined()
  })

  it('keeps form and challenge for invalid OTP, then allows correction', async () => {
    const transport = createMockHumanInputV2FormTransport()
    const { result } = renderHook(() =>
      useHumanInputV2FormSession({
        token: 'form-token',
        transport,
      }),
    )
    await waitFor(() => expect(result.current.state.phase).toBe('awaiting-otp'))
    const challenge = result.current.state.challenge
    act(() => result.current.setOtpCode('000000'))
    await act(async () => result.current.submit({}, 'approve'))

    expect(result.current.state).toMatchObject({
      phase: 'proof-error',
      error: 'invalid-otp',
      challenge,
    })

    act(() => result.current.setOtpCode(HUMAN_INPUT_V2_MOCK_OTP))
    await act(async () => result.current.submit({}, 'approve'))
    expect(result.current.state.phase).toBe('success')
  })

  it('ignores late definition and access responses after the route token changes', async () => {
    const oldDefinition =
      deferred<ReturnType<typeof createHumanInputV2MockScenario>['definition']>()
    const newDefinition =
      deferred<ReturnType<typeof createHumanInputV2MockScenario>['definition']>()
    const baseDefinition = createHumanInputV2MockScenario().definition
    const requestAccess = vi.fn<HumanInputV2FormTransport['requestAccess']>().mockResolvedValue({
      challengeToken: 'new-challenge',
      resendAfterSeconds: 30,
      expiresInSeconds: 300,
    })
    const transport = withOverrides({
      getForm: vi.fn((token: string) =>
        token === 'old-token' ? oldDefinition.promise : newDefinition.promise,
      ),
      requestAccess,
    })
    const { result, rerender } = renderHook(
      ({ token }) => useHumanInputV2FormSession({ token, transport }),
      { initialProps: { token: 'old-token' } },
    )

    rerender({ token: 'new-token' })
    await act(async () =>
      newDefinition.resolve({
        ...baseDefinition,
        formContent: 'new definition',
      }),
    )
    await waitFor(() => expect(result.current.state.phase).toBe('awaiting-otp'))
    act(() => result.current.setOtpCode('123456'))

    await act(async () =>
      oldDefinition.resolve({
        ...baseDefinition,
        formContent: 'old definition',
      }),
    )

    expect(result.current.state.definition?.formContent).toBe('new definition')
    expect(result.current.state.challenge?.challengeToken).toBe('new-challenge')
    expect(requestAccess).toHaveBeenCalledTimes(1)
    expect(requestAccess).toHaveBeenCalledWith('new-token')
  })

  it('ignores a late access response from the previous route session', async () => {
    const oldAccess = deferred<{
      challengeToken: string
      resendAfterSeconds: number
      expiresInSeconds: number
    }>()
    const definition = createHumanInputV2MockScenario().definition
    const requestAccess = vi
      .fn<HumanInputV2FormTransport['requestAccess']>()
      .mockImplementation((token) =>
        token === 'old-token'
          ? oldAccess.promise
          : Promise.resolve({
              challengeToken: 'new-challenge',
              resendAfterSeconds: 30,
              expiresInSeconds: 300,
            }),
      )
    const transport = withOverrides({
      getForm: vi.fn().mockResolvedValue(definition),
      requestAccess,
    })
    const { result, rerender } = renderHook(
      ({ token }) => useHumanInputV2FormSession({ token, transport }),
      { initialProps: { token: 'old-token' } },
    )
    await waitFor(() => expect(requestAccess).toHaveBeenCalledWith('old-token'))

    rerender({ token: 'new-token' })
    await waitFor(() =>
      expect(result.current.state.challenge?.challengeToken).toBe('new-challenge'),
    )

    await act(async () =>
      oldAccess.resolve({
        challengeToken: 'old-challenge',
        resendAfterSeconds: 30,
        expiresInSeconds: 300,
      }),
    )
    expect(result.current.state.challenge?.challengeToken).toBe('new-challenge')
    expect(requestAccess).toHaveBeenCalledTimes(2)
  })

  it('starts a clean proof session when the route token changes after success', async () => {
    const transport = createMockHumanInputV2FormTransport()
    const { result, rerender } = renderHook(
      ({ token }) => useHumanInputV2FormSession({ token, transport }),
      { initialProps: { token: 'first-token' } },
    )
    await waitFor(() => expect(result.current.state.phase).toBe('awaiting-otp'))
    const firstChallenge = result.current.state.challenge?.challengeToken
    act(() => result.current.setOtpCode(HUMAN_INPUT_V2_MOCK_OTP))
    await act(async () => result.current.submit({}, 'approve'))
    expect(result.current.state.phase).toBe('success')

    rerender({ token: 'second-token' })
    await waitFor(() => expect(result.current.state.phase).toBe('awaiting-otp'))

    expect(result.current.state.otpCode).toBe('')
    expect(result.current.state.challenge?.challengeToken).not.toBe(firstChallenge)
  })

  it('does not persist or log OTP and Challenge values', async () => {
    const setLocalStorage = vi.spyOn(Storage.prototype, 'setItem')
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    const transport = createMockHumanInputV2FormTransport()
    const { result } = renderHook(() =>
      useHumanInputV2FormSession({
        token: 'form-token',
        transport,
      }),
    )
    await waitFor(() => expect(result.current.state.phase).toBe('awaiting-otp'))
    act(() => result.current.setOtpCode(HUMAN_INPUT_V2_MOCK_OTP))

    expect(setLocalStorage).not.toHaveBeenCalled()
    expect(consoleLog).not.toHaveBeenCalled()
    expect(window.location.href).not.toContain(HUMAN_INPUT_V2_MOCK_OTP)
    expect(window.location.href).not.toContain('mock-challenge-1')
    consoleLog.mockRestore()
    setLocalStorage.mockRestore()
  })
})
