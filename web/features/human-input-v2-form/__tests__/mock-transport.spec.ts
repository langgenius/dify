import { normalizeHumanInputV2Error } from '../errors'
import {
  createHumanInputV2MockScenario,
  createMockHumanInputV2FormTransport,
  HUMAN_INPUT_V2_MOCK_OTP,
} from '../mock-transport'
import { getHumanInputV2Paths, realHumanInputV2FormTransport } from '../real-transport'
import {
  defaultHumanInputV2FormTransport,
  selectHumanInputV2FormTransport,
} from '../transport-selector'

describe('Human Input v2 transports', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('uses canonical hyphenated endpoint paths without exposing the raw token', () => {
    expect(getHumanInputV2Paths('token/with space')).toEqual({
      form: '/form/human-input/token%2Fwith%20space',
      accessRequest: '/form/human-input/token%2Fwith%20space/access-request',
      uploadToken: '/form/human-input/token%2Fwith%20space/upload-token',
    })
  })

  it('uses the real adapter in local development and reports backend 501 without mock fallback', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Not implemented' }), {
          status: 501,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    expect(defaultHumanInputV2FormTransport).toBe(realHumanInputV2FormTransport)
    const error = await realHumanInputV2FormTransport
      .getForm('secret-form-token')
      .catch((error) => error)
    expect(normalizeHumanInputV2Error(error)).toMatchObject({
      category: 'unavailable',
      status: 501,
    })
  })

  it.each([
    [400, 'human_input_invalid_otp', 'invalid-otp'],
    [400, 'human_input_challenge_expired', 'challenge-expired'],
    [409, 'human_input_challenge_stale', 'challenge-stale'],
    [429, 'human_input_access_rate_limit_exceeded', 'access-rate-limit'],
  ] as const)(
    'preserves the %s %s API error without exposing proof',
    async (status, code, category) => {
      const formToken = 'secret-form-token'
      const challengeToken = 'secret-challenge-token'
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              code,
              status,
              message: `Form ${formToken}, OTP ${HUMAN_INPUT_V2_MOCK_OTP}, challenge ${challengeToken}`,
            }),
            { status, headers: { 'Content-Type': 'application/json' } },
          ),
        ),
      )

      const request =
        status === 429
          ? realHumanInputV2FormTransport.requestAccess(formToken)
          : realHumanInputV2FormTransport.submit(formToken, {
              inputs: {},
              action: 'approve',
              otp_code: HUMAN_INPUT_V2_MOCK_OTP,
              challenge_token: challengeToken,
            })
      const normalized = await request.catch(normalizeHumanInputV2Error)

      expect(normalized).toMatchObject({ category, code, status })
      for (const secret of [formToken, HUMAN_INPUT_V2_MOCK_OTP, challengeToken]) {
        expect(String(normalized)).not.toContain(secret)
        expect(JSON.stringify(normalized)).not.toContain(secret)
      }
    },
  )

  it('uses the generated v2 definition path, maps defaults, and omits console cookies', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          form_content: 'Review {{#$output.response#}}',
          expiration_time: 1_900_000_000,
          inputs: [
            { type: 'paragraph', output_variable_name: 'response' },
            {
              type: 'select',
              output_variable_name: 'choice',
              option_source: { type: 'constant', value: ['Yes', 'No'] },
            },
          ],
          user_actions: [{ id: 'approve', title: 'Approve' }],
          resolved_default_values: { response: 'ready' },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetch)
    const controller = new AbortController()
    const definition = await realHumanInputV2FormTransport.getForm('token/with space', {
      signal: controller.signal,
    })
    expect(fetch.mock.calls[0]![0].url).toContain('/form/human-input/token%2Fwith%20space')
    expect(fetch.mock.calls[0]![1]).toMatchObject({ credentials: 'omit', cache: 'no-store' })
    expect(definition).toMatchObject({
      expirationTime: 1_900_000_000,
      resolvedDefaultValues: { response: 'ready' },
      inputs: [
        { default: { type: 'constant', value: '', selector: [] } },
        { option_source: { type: 'constant', value: ['Yes', 'No'], selector: [] } },
      ],
      actions: [{ id: 'approve', button_style: 'default' }],
    })
  })

  it('posts challenge proof and obtains upload authorization from v2 paths', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            challenge_token: 'proof',
            expires_in_seconds: 300,
            resend_after_seconds: 60,
          }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response('{}', { headers: { 'Content-Type': 'application/json' } }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ upload_token: 'upload-proof', expires_at: 1900000000 }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    vi.stubGlobal('fetch', fetch)
    await expect(realHumanInputV2FormTransport.requestAccess('form-token')).resolves.toEqual({
      challengeToken: 'proof',
      expiresInSeconds: 300,
      resendAfterSeconds: 60,
    })
    const payload = {
      inputs: { choice: 'Yes' },
      action: 'approve',
      otp_code: '123456',
      challenge_token: 'proof',
    }
    await realHumanInputV2FormTransport.submit('form-token', payload)
    expect(fetch.mock.calls[1]![0].url).toContain('/form/human-input/form-token')
    expect(await fetch.mock.calls[1]![0].json()).toEqual(payload)
    await expect(realHumanInputV2FormTransport.requestUploadToken('form-token')).resolves.toEqual({
      uploadToken: 'upload-proof',
      expiresAt: 1900000000000,
    })
    expect(fetch.mock.calls[0]![0].url).toContain('/form/human-input/form-token/access-request')
    expect(fetch.mock.calls[2]![0].url).toContain('/form/human-input/form-token/upload-token')
    await expect(
      realHumanInputV2FormTransport.uploadLocalFile('form-token', new File(['test'], 'test.txt')),
    ).rejects.toMatchObject({ category: 'unavailable' })
    expect(fetch).toHaveBeenCalledTimes(3)
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
