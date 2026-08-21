import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { emailLoginWithCode, sendEMailLoginCode } from './common'

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
}))

vi.mock('./base', () => ({
  del: vi.fn(),
  get: vi.fn(),
  patch: vi.fn(),
  post: mocks.post,
}))

describe('sendEMailLoginCode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('includes the Turnstile token when provided', async () => {
    await sendEMailLoginCode('user@example.com', 'en-US', 'turnstile-token')

    expect(mocks.post).toHaveBeenCalledWith('/email-code-login', {
      body: {
        email: 'user@example.com',
        language: 'en-US',
        turnstile_token: 'turnstile-token',
      },
    })
  })

  it('omits the Turnstile token when it is not provided', async () => {
    await sendEMailLoginCode('user@example.com', 'en-US')

    expect(mocks.post).toHaveBeenCalledWith('/email-code-login', {
      body: {
        email: 'user@example.com',
        language: 'en-US',
      },
    })
  })
})

describe('emailLoginWithCode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('includes the verification-specific Turnstile token when provided', async () => {
    await emailLoginWithCode({
      code: 'encrypted-code',
      email: 'user@example.com',
      language: 'en-US',
      timezone: 'Asia/Singapore',
      token: 'email-login-token',
      turnstile_token: 'verify-turnstile-token',
    })

    expect(mocks.post).toHaveBeenCalledWith('/email-code-login/validity', {
      body: {
        code: 'encrypted-code',
        email: 'user@example.com',
        language: 'en-US',
        timezone: 'Asia/Singapore',
        token: 'email-login-token',
        turnstile_token: 'verify-turnstile-token',
      },
    })
  })
})
