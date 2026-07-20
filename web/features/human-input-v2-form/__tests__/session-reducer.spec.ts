import { createHumanInputV2MockScenario } from '../mock-transport'
import { humanInputV2SessionReducer, initialHumanInputV2SessionState } from '../session-reducer'

describe('Human Input v2 session reducer', () => {
  const definition = createHumanInputV2MockScenario().definition
  const challenge = {
    challengeToken: 'challenge-1',
    resendAfterSeconds: 30,
    expiresInSeconds: 300,
    receivedAt: 1_000,
    resendAt: 31_000,
    expiresAt: 301_000,
  }

  it('covers the form, access, verification, submit, terminal, and success phases', () => {
    let state = humanInputV2SessionReducer(initialHumanInputV2SessionState, {
      type: 'form-loaded',
      definition,
    })
    expect(state.phase).toBe('requesting-otp')

    state = humanInputV2SessionReducer(state, { type: 'access-succeeded', challenge })
    expect(state.phase).toBe('awaiting-otp')

    state = humanInputV2SessionReducer(state, { type: 'otp-changed', otpCode: '246810' })
    state = humanInputV2SessionReducer(state, { type: 'submit-requested' })
    expect(state.phase).toBe('submitting')

    state = humanInputV2SessionReducer(state, {
      type: 'submit-proof-failed',
      error: 'invalid-otp',
    })
    expect(state).toMatchObject({ phase: 'proof-error', challenge, otpCode: '246810' })

    state = humanInputV2SessionReducer(state, { type: 'submit-succeeded' })
    expect(state).toMatchObject({ phase: 'success', otpCode: '' })
    expect(state.challenge).toBeUndefined()
  })

  it('distinguishes recoverable definition/access failures from terminal errors', () => {
    expect(
      humanInputV2SessionReducer(initialHumanInputV2SessionState, {
        type: 'form-failed',
        error: 'network',
        terminal: false,
      }).phase,
    ).toBe('form-error')

    expect(
      humanInputV2SessionReducer(initialHumanInputV2SessionState, {
        type: 'form-failed',
        error: 'not-found',
        terminal: true,
      }).phase,
    ).toBe('terminal')

    const withDefinition = {
      ...initialHumanInputV2SessionState,
      definition,
      phase: 'requesting-otp' as const,
    }
    expect(
      humanInputV2SessionReducer(withDefinition, {
        type: 'access-failed',
        error: 'access-delivery-failed',
        preserveChallenge: false,
      }).phase,
    ).toBe('access-error')
  })

  it('preserves unexpired proof on transient resend failure', () => {
    const state = {
      ...initialHumanInputV2SessionState,
      definition,
      challenge,
      otpCode: '246810',
      phase: 'requesting-otp' as const,
    }

    expect(
      humanInputV2SessionReducer(state, {
        type: 'access-failed',
        error: 'network',
        preserveChallenge: true,
      }),
    ).toMatchObject({
      phase: 'awaiting-otp',
      challenge,
      otpCode: '246810',
      error: 'network',
    })
  })

  it('clears sensitive proof when a challenge expires or becomes stale', () => {
    const state = {
      ...initialHumanInputV2SessionState,
      definition,
      challenge,
      otpCode: '246810',
      phase: 'awaiting-otp' as const,
    }

    expect(humanInputV2SessionReducer(state, { type: 'challenge-expired' })).toMatchObject({
      phase: 'challenge-expired',
      challenge: undefined,
      otpCode: '',
    })
    expect(
      humanInputV2SessionReducer(state, {
        type: 'submit-challenge-failed',
        error: 'challenge-stale',
      }),
    ).toMatchObject({
      phase: 'challenge-expired',
      challenge: undefined,
      otpCode: '',
    })
  })

  it('clears proof for terminal submit failures', () => {
    const state = {
      ...initialHumanInputV2SessionState,
      definition,
      challenge,
      otpCode: '246810',
      phase: 'submitting' as const,
    }

    const terminalState = humanInputV2SessionReducer(state, {
      type: 'submit-terminal-failed',
      error: 'already-submitted',
    })
    expect(terminalState).toMatchObject({
      phase: 'terminal',
      otpCode: '',
    })
    expect(terminalState.challenge).toBeUndefined()
  })
})
