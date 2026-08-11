import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sendEMailLoginCode } from './common'

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
