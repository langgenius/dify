import { normalizeHumanInputV2Error } from '../errors'
import {
  createHumanInputV2MockScenario,
  createMockHumanInputV2FormTransport,
  HUMAN_INPUT_V2_MOCK_OTP,
} from '../mock-transport'
import { getHumanInputV2Paths, realHumanInputV2FormTransport } from '../real-transport'
import { selectHumanInputV2FormTransport } from '../transport-selector'

describe('Human Input v2 transports', () => {
  it('uses canonical hyphenated endpoint paths without exposing the raw token', () => {
    expect(getHumanInputV2Paths('token/with space')).toEqual({
      form: '/form/human-input/token%2Fwith%20space',
      accessRequest: '/form/human-input/token%2Fwith%20space/access-request',
      uploadToken: '/form/human-input/token%2Fwith%20space/upload-token',
    })
  })

  it('returns an explicit unavailable error from the real adapter boundary', async () => {
    await expect(realHumanInputV2FormTransport.getForm('secret-form-token')).rejects.toMatchObject({
      category: 'unavailable',
      code: 'human_input_v2_unavailable',
    })
  })

  it('never selects a mock adapter in production', () => {
    const mockTransport = createMockHumanInputV2FormTransport()
    const selected = selectHumanInputV2FormTransport({
      adapter: 'mock',
      environment: 'production',
      mockTransport,
      realTransport: realHumanInputV2FormTransport,
    })

    expect(selected).toBe(realHumanInputV2FormTransport)
    expect(selected).not.toBe(mockTransport)
    return expect(
      selected.submit('form-token', {
        inputs: {},
        action: 'approve',
        otp_code: HUMAN_INPUT_V2_MOCK_OTP,
        challenge_token: 'mock-challenge-1',
      }),
    ).rejects.toMatchObject({ category: 'unavailable' })
  })

  it('selects an explicitly injected mock only outside production', () => {
    const mockTransport = createMockHumanInputV2FormTransport()

    expect(
      selectHumanInputV2FormTransport({
        adapter: 'mock',
        environment: 'test',
        mockTransport,
      }),
    ).toBe(mockTransport)
  })

  it.each([
    ['not-found', 'not-found'],
    ['expired', 'form-expired'],
    ['submitted', 'already-submitted'],
    ['rate-limited', 'form-rate-limit'],
  ] as const)('models the %s form scenario', async (formState, category) => {
    const transport = createMockHumanInputV2FormTransport({ scenario: { formState } })

    await expect(transport.getForm('form-token')).rejects.toMatchObject({ category })
  })

  it('issues unique challenges, enforces cooldown, and invalidates replaced proof', async () => {
    let now = 10_000
    const transport = createMockHumanInputV2FormTransport({
      now: () => now,
      scenario: { resendAfterSeconds: 10, expiresInSeconds: 60 },
    })
    const first = await transport.requestAccess('form-token')

    await expect(transport.requestAccess('form-token')).rejects.toMatchObject({
      category: 'access-rate-limit',
    })

    now += 10_000
    const second = await transport.requestAccess('form-token')
    expect(second.challengeToken).not.toBe(first.challengeToken)

    await expect(
      transport.submit('form-token', {
        inputs: { response: 'approved' },
        action: 'approve',
        otp_code: HUMAN_INPUT_V2_MOCK_OTP,
        challenge_token: first.challengeToken,
      }),
    ).rejects.toMatchObject({ category: 'challenge-stale' })

    await expect(
      transport.submit('form-token', {
        inputs: { response: 'approved' },
        action: 'approve',
        otp_code: HUMAN_INPUT_V2_MOCK_OTP,
        challenge_token: second.challengeToken,
      }),
    ).resolves.toBeUndefined()
  })

  it('validates OTP and challenge expiry without consuming valid proof', async () => {
    let now = 1_000
    const transport = createMockHumanInputV2FormTransport({
      now: () => now,
      scenario: { expiresInSeconds: 5 },
    })
    const challenge = await transport.requestAccess('form-token')
    const payload = {
      inputs: {},
      action: 'approve',
      otp_code: '000000',
      challenge_token: challenge.challengeToken,
    }

    await expect(transport.submit('form-token', payload)).rejects.toMatchObject({
      category: 'invalid-otp',
    })

    now += 5_000
    await expect(
      transport.submit('form-token', {
        ...payload,
        otp_code: HUMAN_INPUT_V2_MOCK_OTP,
      }),
    ).rejects.toMatchObject({ category: 'challenge-expired' })
  })

  it.each([
    ['delivery-failed', 'access-delivery-failed'],
    ['rate-limited', 'access-rate-limit'],
  ] as const)('models the %s access scenario', async (accessState, category) => {
    const transport = createMockHumanInputV2FormTransport({ scenario: { accessState } })

    await expect(transport.requestAccess('form-token')).rejects.toMatchObject({ category })
  })

  it('supports definition fixtures with optional branding', async () => {
    const definition = createHumanInputV2MockScenario().definition
    const transport = createMockHumanInputV2FormTransport({
      scenario: {
        definition: {
          ...definition,
          branding: undefined,
          resolvedDefaultValues: { response: 'resolved response' },
        },
      },
    })

    await expect(transport.getForm('form-token')).resolves.toMatchObject({
      branding: undefined,
      resolvedDefaultValues: { response: 'resolved response' },
    })
  })

  it('returns upload tokens and handles local and remote files without network requests', async () => {
    const transport = createMockHumanInputV2FormTransport()
    const file = new File(['content'], 'review.txt', { type: 'text/plain' })

    await expect(transport.requestUploadToken('form-token')).resolves.toMatchObject({
      uploadToken: expect.stringMatching(/^mock-upload-token-/),
    })
    await expect(transport.uploadLocalFile('form-token', file)).resolves.toMatchObject({
      name: 'review.txt',
      mimeType: 'text/plain',
    })
    await expect(
      transport.uploadRemoteFile('form-token', 'https://example.com/review.txt'),
    ).resolves.toMatchObject({ url: 'https://example.com/review.txt' })
  })

  it('models upload failure and concurrent completion', async () => {
    const uploadTransport = createMockHumanInputV2FormTransport({
      scenario: { uploadState: 'failed' },
    })
    await expect(uploadTransport.requestUploadToken('form-token')).rejects.toMatchObject({
      category: 'upload-failed',
    })

    const submitTransport = createMockHumanInputV2FormTransport({
      scenario: { submitState: 'concurrent-completion' },
    })
    const challenge = await submitTransport.requestAccess('form-token')
    await expect(
      submitTransport.submit('form-token', {
        inputs: {},
        action: 'approve',
        otp_code: HUMAN_INPUT_V2_MOCK_OTP,
        challenge_token: challenge.challengeToken,
      }),
    ).rejects.toMatchObject({ category: 'already-submitted' })
  })

  it('redacts raw error text and proof values during normalization', () => {
    const normalized = normalizeHumanInputV2Error({
      code: 'human_input_invalid_otp',
      message: `OTP ${HUMAN_INPUT_V2_MOCK_OTP}, challenge secret-challenge`,
      status: 400,
    })

    expect(normalized.category).toBe('invalid-otp')
    expect(normalized.message).not.toContain(HUMAN_INPUT_V2_MOCK_OTP)
    expect(normalized.message).not.toContain('secret-challenge')
  })
})
