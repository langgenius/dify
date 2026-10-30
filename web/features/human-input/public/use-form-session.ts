'use client'
import type { HumanInputV2FormTransport } from './types'
import { useCallback, useEffect, useReducer, useState } from 'react'
import { isTerminalFormError, normalizeHumanInputV2Error } from './errors'
import { humanInputV2SessionReducer, initialHumanInputV2SessionState } from './session-reducer'

type UseHumanInputV2FormSessionOptions = {
  token: string
  transport: HumanInputV2FormTransport
  now?: () => number
}

export const useHumanInputV2FormSession = ({
  token,
  transport,
  now = Date.now,
}: UseHumanInputV2FormSessionOptions) => {
  const [state, dispatch] = useReducer(humanInputV2SessionReducer, initialHumanInputV2SessionState)
  const [runtime] = useState(() => ({
    token,
    transport,
    controller: undefined as AbortController | undefined,
    accessing: false,
    submitting: false,
  }))
  const isCurrent = useCallback(
    (signal: AbortSignal) => runtime.controller?.signal === signal && !signal.aborted,
    [runtime],
  )
  const requestAccess = useCallback(
    async (signal: AbortSignal, preserveChallenge: boolean) => {
      if (!isCurrent(signal) || runtime.accessing || runtime.submitting) return
      runtime.accessing = true
      dispatch({ type: 'access-requested' })
      try {
        const response = await runtime.transport.requestAccess(runtime.token, { signal })
        if (!isCurrent(signal)) return
        const receivedAt = now()
        dispatch({
          type: 'access-succeeded',
          challenge: {
            ...response,
            receivedAt,
            resendAt: receivedAt + response.resendAfterSeconds * 1000,
            expiresAt: receivedAt + response.expiresInSeconds * 1000,
          },
        })
      } catch (error) {
        if (isCurrent(signal))
          dispatch({
            type: 'access-failed',
            error: normalizeHumanInputV2Error(error).category,
            preserveChallenge,
          })
      } finally {
        if (isCurrent(signal)) runtime.accessing = false
      }
    },
    [isCurrent, now, runtime],
  )

  const load = useCallback(
    async (signal: AbortSignal) => {
      try {
        const definition = await runtime.transport.getForm(runtime.token, { signal })
        if (!isCurrent(signal)) return
        dispatch({ type: 'form-loaded', definition })
        await requestAccess(signal, false)
      } catch (error) {
        if (!isCurrent(signal)) return
        const normalized = normalizeHumanInputV2Error(error)
        dispatch({
          type: 'form-failed',
          error: normalized.category,
          terminal: isTerminalFormError(normalized.category),
        })
      }
    },
    [isCurrent, requestAccess, runtime],
  )

  useEffect(() => {
    const controller = new AbortController()
    runtime.controller = controller
    runtime.accessing = false
    runtime.submitting = false
    void load(controller.signal)
    return () => runtime.controller?.abort()
  }, [load, runtime])

  useEffect(() => {
    if (!state.challenge || state.phase === 'submitting') return
    const remaining = state.challenge.expiresAt - now()
    const expire = () => dispatch({ type: 'challenge-expired' })
    const checkExpiry = () => {
      if (now() >= state.challenge!.expiresAt) expire()
    }
    window.addEventListener('focus', checkExpiry)
    document.addEventListener('visibilitychange', checkExpiry)
    const timer = window.setTimeout(expire, Math.min(Math.max(0, remaining), 2_147_483_647))
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('focus', checkExpiry)
      document.removeEventListener('visibilitychange', checkExpiry)
    }
  }, [now, state.challenge, state.phase])

  const retryForm = useCallback(() => {
    runtime.controller?.abort()
    const controller = new AbortController()
    runtime.controller = controller
    runtime.accessing = false
    runtime.submitting = false
    dispatch({ type: 'reset' })
    void load(controller.signal)
  }, [load, runtime])

  const retryAccess = useCallback(() => {
    const signal = runtime.controller?.signal
    if (signal) void requestAccess(signal, false)
  }, [requestAccess, runtime])
  const resendAccess = useCallback(() => {
    const signal = runtime.controller?.signal
    if (!signal || !state.challenge || now() < state.challenge.resendAt) return
    void requestAccess(signal, now() < state.challenge.expiresAt)
  }, [now, requestAccess, runtime, state.challenge])
  const setOtpCode = useCallback((otpCode: string) => {
    dispatch({ type: 'otp-changed', otpCode: otpCode.replace(/\D/g, '').slice(0, 6) })
  }, [])
  const canSubmit = Boolean(
    state.challenge &&
    now() < state.challenge.expiresAt &&
    /^\d{6}$/.test(state.otpCode) &&
    ['awaiting-otp', 'proof-error'].includes(state.phase),
  )
  const submit = useCallback(
    async (inputs: Record<string, unknown>, action: string) => {
      const signal = runtime.controller?.signal
      if (!signal || !isCurrent(signal) || runtime.submitting) return
      const challenge = state.challenge
      if (!challenge || now() >= challenge.expiresAt) {
        dispatch({ type: 'challenge-expired' })
        return
      }
      if (!/^\d{6}$/.test(state.otpCode)) {
        dispatch({ type: 'submit-proof-failed', error: 'invalid-otp' })
        return
      }
      runtime.submitting = true
      dispatch({ type: 'submit-requested' })
      try {
        await runtime.transport.submit(
          runtime.token,
          {
            inputs,
            action,
            otp_code: state.otpCode,
            challenge_token: challenge.challengeToken,
          },
          { signal },
        )
        if (isCurrent(signal)) dispatch({ type: 'submit-succeeded' })
      } catch (error) {
        if (!isCurrent(signal)) return
        const category = normalizeHumanInputV2Error(error).category
        if (category === 'challenge-expired' || category === 'challenge-stale')
          dispatch({ type: 'submit-challenge-failed', error: category })
        else if (category === 'already-submitted' || category === 'form-expired')
          dispatch({ type: 'submit-terminal-failed', error: category })
        else dispatch({ type: 'submit-proof-failed', error: category })
      } finally {
        if (isCurrent(signal)) runtime.submitting = false
      }
    },
    [isCurrent, now, runtime, state.challenge, state.otpCode],
  )

  return { state, canSubmit, retryForm, retryAccess, resendAccess, setOtpCode, submit }
}
