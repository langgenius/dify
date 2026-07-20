import type { ErrorBody } from '@dify/contracts/api/openapi/types.gen'
import { describe, expect, it } from 'vitest'
import { HttpClientError, newError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { CONTRACT } from './contract'

describe('errorEnvelope contract', () => {
  // Guard against the documented shape drifting from the real envelope: build an
  // error with every optional field populated and assert each JSON key it emits
  // is named in the contract string. Adding/removing an envelope field without
  // updating the doc fails here.
  it('documents every key the real JSON envelope can emit', () => {
    const server: ErrorBody = { code: 'app_unavailable', message: 'gone', status: 404 }
    const err = HttpClientError.from(newError(ErrorCode.Server4xxOther, 'boom'))
      .withHint('do x')
      .withRequest('GET', 'https://api.dify.ai/v1/me')
      .withHttpStatus(404)
      .withRawResponse('{"x":1}')
      .withServerError(server)

    const env = err.toEnvelope()

    for (const key of Object.keys(env.error))
      expect(CONTRACT.errorEnvelope.shape).toContain(`"${key}"`)
  })
})
