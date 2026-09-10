import { getInviteErrorCode } from '../invite-error'

describe('getInviteErrorCode', () => {
  it.each(['invalid_param', 'invalid_role', 'limit_exceeded'])(
    'reads the documented %s code from the contract error body',
    (code) => {
      expect(getInviteErrorCode({ data: { body: { code } } })).toBe(code)
    },
  )

  it('ignores transport and undocumented error codes', () => {
    expect(getInviteErrorCode({ code: 'BAD_REQUEST' })).toBeNull()
    expect(getInviteErrorCode({ data: { body: { code: 'invalid-role' } } })).toBeNull()
  })
})
