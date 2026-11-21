import type { ThreadReply } from '../pending-reply'
import { isSavedAs } from '../pending-reply'

const sent: ThreadReply = {
  id: 'local-1',
  content: 'hello',
  created_at: 100,
  created_by: 'user-1',
  send_state: 'failed',
}

describe('isSavedAs', () => {
  it('matches a reply the same author saved with the same text after it was sent', () => {
    expect(
      isSavedAs(sent, { id: 'reply-1', content: 'hello', created_at: 101, created_by: 'user-1' }),
    ).toBe(true)
  })

  it('does not match someone else’s reply, other text, or an older reply', () => {
    expect(
      isSavedAs(sent, { id: 'reply-2', content: 'hello', created_at: 101, created_by: 'user-2' }),
    ).toBe(false)
    expect(
      isSavedAs(sent, { id: 'reply-3', content: 'other', created_at: 101, created_by: 'user-1' }),
    ).toBe(false)
    expect(
      isSavedAs(sent, { id: 'reply-4', content: 'hello', created_at: 10, created_by: 'user-1' }),
    ).toBe(false)
  })
})
