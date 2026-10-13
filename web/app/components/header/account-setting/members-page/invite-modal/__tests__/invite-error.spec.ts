import { createHttpError } from '@/service/http-error'
import { getInviteErrorCode } from '../invite-error'

describe('getInviteErrorCode', () => {
  it.each(['invalid_param', 'invalid_role', 'limit_exceeded'])(
    'reads the documented %s code from the HTTP error',
    (code) => {
      expect(
        getInviteErrorCode(createHttpError(new Response(null, { status: 400 }), { code })),
      ).toBe(code)
    },
  )

  it('ignores transport and undocumented error codes', () => {
    expect(getInviteErrorCode(new TypeError('Failed to fetch'))).toBeNull()
    expect(getInviteErrorCode(createHttpError(new Response(null, { status: 503 })))).toBeNull()
    expect(
      getInviteErrorCode(
        createHttpError(new Response(null, { status: 400 }), { code: 'member_not_found' }),
      ),
    ).toBeNull()
  })
})
