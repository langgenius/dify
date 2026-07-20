'use client'
import type { HumanInputV2FormTransport } from './types'
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { isTerminalFormError, normalizeHumanInputV2Error } from './errors'
import { humanInputV2SessionReducer, initialHumanInputV2SessionState } from './session-reducer'

type Runtime = {
  token: string
  transport: HumanInputV2FormTransport
  loadStarted: boolean
  autoAccessStarted: boolean
  resetState: boolean
}

type UseHumanInputV2FormSessionOptions = {
  token: string
  transport: HumanInputV2FormTransport
  now?: () => number
}

const OTP_PATTERN = /^\d{6}$/

export const isValidHumanInputV2Otp = (otpCode: string) => OTP_PATTERN.test(otpCode)

export const useHumanInputV2FormSession = ({
  token,
  transport,
  now = Date.now,
}: UseHumanInputV2FormSessionOptions) => {
  const [state, dispatch] = useReducer(humanInputV2SessionReducer, initialHumanInputV2SessionState)
  const [clock, setClock] = useState(now)
  const runtimeRef = useRef<Runtime | undefined>(undefined)
  const accessLockRef = useRef(false)
  const submitLockRef = useRef(false)

  const runtimeChanged = Boolean(
    runtimeRef.current &&
    (runtimeRef.current.token !== token || runtimeRef.current.transport !== transport),
  )
  if (
    !runtimeRef.current ||
    runtimeRef.current.token !== token ||
    runtimeRef.current.transport !== transport
  ) {
    runtimeRef.current = {
      token,
      transport,
      loadStarted: false,
      autoAccessStarted: false,
      resetState: runtimeChanged,
    }
    accessLockRef.current = false
    submitLockRef.current = false
  }
  const runtime = runtimeRef.current

  const isCurrentRuntime = useCallback((candidate: Runtime) => runtimeRef.current === candidate, [])

  const applyAccessResponse = useCallback(
    (
      candidate: Runtime,
      response: Awaited<ReturnType<HumanInputV2FormTransport['requestAccess']>>,
    ) => {
      if (!isCurrentRuntime(candidate)) return
      const receivedAt = now()
      setClock(receivedAt)
      dispatch({
        type: 'access-succeeded',
        challenge: {
          ...response,
          receivedAt,
          resendAt: receivedAt + response.resendAfterSeconds * 1000,
          expiresAt: receivedAt + response.expiresInSeconds * 1000,
        },
      })
    },
    [isCurrentRuntime, now],
  )

  const requestAccessForRuntime = useCallback(
    async (candidate: Runtime, preserveChallenge: boolean) => {
      if (accessLockRef.current) return
      accessLockRef.current = true
      dispatch({ type: 'access-requested' })
      try {
        const response = await candidate.transport.requestAccess(candidate.token)
        applyAccessResponse(candidate, response)
      } catch (error) {
        if (!isCurrentRuntime(candidate)) return
        dispatch({
          type: 'access-failed',
          error: normalizeHumanInputV2Error(error).category,
          preserveChallenge,
        })
      } finally {
        if (isCurrentRuntime(candidate)) accessLockRef.current = false
      }
    },
    [applyAccessResponse, isCurrentRuntime],
  )

  const loadForm = useCallback(
    async (candidate: Runtime) => {
      if (candidate.loadStarted) return
      candidate.loadStarted = true
      try {
        const definition = await candidate.transport.getForm(candidate.token)
        if (!isCurrentRuntime(candidate)) return
        dispatch({ type: 'form-loaded', definition })
        if (!candidate.autoAccessStarted) {
          candidate.autoAccessStarted = true
          await requestAccessForRuntime(candidate, false)
        }
      } catch (error) {
        if (!isCurrentRuntime(candidate)) return
        const normalizedError = normalizeHumanInputV2Error(error)
        dispatch({
          type: 'form-failed',
          error: normalizedError.category,
          terminal: isTerminalFormError(normalizedError.category),
        })
      }
    },
    [isCurrentRuntime, requestAccessForRuntime],
  )

  useEffect(() => {
    if (runtime.resetState) {
      runtime.resetState = false
      dispatch({ type: 'reset' })
    }
    void loadForm(runtime)
  }, [loadForm, runtime])

  useEffect(() => {
    if (!state.challenge) return
    const updateClock = () => setClock(now())
    const timer = window.setInterval(updateClock, 1000)
    window.addEventListener('focus', updateClock)
    document.addEventListener('visibilitychange', updateClock)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', updateClock)
      document.removeEventListener('visibilitychange', updateClock)
    }
  }, [now, state.challenge])

  useEffect(() => {
    if (state.challenge && clock >= state.challenge.expiresAt)
      dispatch({ type: 'challenge-expired' })
  }, [clock, state.challenge])

  const retryForm = useCallback(() => {
    const nextRuntime: Runtime = {
      token,
      transport,
      loadStarted: false,
      autoAccessStarted: false,
      resetState: false,
    }
    runtimeRef.current = nextRuntime
    accessLockRef.current = false
    submitLockRef.current = false
    dispatch({ type: 'reset' })
    void loadForm(nextRuntime)
  }, [loadForm, token, transport])

  const retryAccess = useCallback(() => {
    void requestAccessForRuntime(runtimeRef.current!, false)
  }, [requestAccessForRuntime])

  const resendAccess = useCallback(() => {
    const challenge = state.challenge
    if (!challenge || now() < challenge.resendAt) return
    const preserveChallenge = now() < challenge.expiresAt
    void requestAccessForRuntime(runtimeRef.current!, preserveChallenge)
  }, [now, requestAccessForRuntime, state.challenge])

  const setOtpCode = useCallback((otpCode: string) => {
    dispatch({ type: 'otp-changed', otpCode: otpCode.replace(/\D/g, '').slice(0, 6) })
  }, [])

  const canSubmit = Boolean(
    state.challenge &&
    clock < state.challenge.expiresAt &&
    isValidHumanInputV2Otp(state.otpCode) &&
    ['awaiting-otp', 'proof-error'].includes(state.phase),
  )

  const submit = useCallback(
    async (inputs: Record<string, unknown>, action: string) => {
      const challenge = state.challenge
      if (!challenge || !canSubmit || submitLockRef.current) return
      if (now() >= challenge.expiresAt) {
        dispatch({ type: 'challenge-expired' })
        return
      }
      const candidate = runtimeRef.current!
      submitLockRef.current = true
      dispatch({ type: 'submit-requested' })
      try {
        await transport.submit(token, {
          inputs,
          action,
          otp_code: state.otpCode,
          challenge_token: challenge.challengeToken,
        })
        if (!isCurrentRuntime(candidate)) return
        dispatch({ type: 'submit-succeeded' })
      } catch (error) {
        if (!isCurrentRuntime(candidate)) return
        const normalizedError = normalizeHumanInputV2Error(error)
        if (
          normalizedError.category === 'challenge-expired' ||
          normalizedError.category === 'challenge-stale'
        ) {
          dispatch({ type: 'submit-challenge-failed', error: normalizedError.category })
        } else if (
          normalizedError.category === 'already-submitted' ||
          normalizedError.category === 'form-expired'
        ) {
          dispatch({ type: 'submit-terminal-failed', error: normalizedError.category })
        } else {
          dispatch({ type: 'submit-proof-failed', error: normalizedError.category })
        }
      } finally {
        if (isCurrentRuntime(candidate)) submitLockRef.current = false
      }
    },
    [canSubmit, isCurrentRuntime, now, state.challenge, state.otpCode, token, transport],
  )

  const secondsUntilResend = state.challenge
    ? Math.max(0, Math.ceil((state.challenge.resendAt - clock) / 1000))
    : 0
  const secondsUntilExpiry = state.challenge
    ? Math.max(0, Math.ceil((state.challenge.expiresAt - clock) / 1000))
    : 0

  return {
    state,
    canSubmit,
    secondsUntilResend,
    secondsUntilExpiry,
    retryForm,
    retryAccess,
    resendAccess,
    setOtpCode,
    submit,
  }
}
