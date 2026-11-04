import { normalizeHumanInputV2Error } from '../errors'
import { realHumanInputV2FormTransport } from '../real-transport'
import { HUMAN_INPUT_V2_MOCK_OTP } from './fixtures/mock-transport'
describe('Human Input v2 transports', () => {
  afterEach(() => vi.unstubAllGlobals())
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
    expect(fetch.mock.calls[0]![0].url).toContain(
      '/form/human-input/v2/public/token%2Fwith%20space',
    )
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
    expect(fetch.mock.calls[1]![0].url).toContain('/form/human-input/v2/public/form-token')
    expect(await fetch.mock.calls[1]![0].json()).toEqual(payload)
    await expect(realHumanInputV2FormTransport.requestUploadToken('form-token')).resolves.toEqual({
      uploadToken: 'upload-proof',
      expiresAt: 1900000000000,
    })
    expect(fetch.mock.calls[0]![0].url).toContain(
      '/form/human-input/v2/public/form-token/access-request',
    )
    expect(fetch.mock.calls[2]![0].url).toContain(
      '/form/human-input/v2/public/form-token/upload-token',
    )
    expect(fetch).toHaveBeenCalledTimes(3)
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
