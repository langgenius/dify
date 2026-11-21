import type { ThreadReply } from '../pending-reply'
import { mergeFetchedReplies } from '../pending-reply'

const local = (overrides: Partial<ThreadReply>): ThreadReply => ({
  id: 'local-1',
  client_key: 'local-1',
  content: 'hello',
  created_at: 100,
  created_by: 'user-1',
  send_state: 'failed',
  ...overrides,
})

describe('mergeFetchedReplies', () => {
  it('keeps unsent replies the server does not have, after the fetched ones', () => {
    const fetched = [{ id: 'reply-1', content: 'earlier', created_at: 50, created_by: 'user-1' }]
    expect(mergeFetchedReplies([local({})], fetched).map((reply) => reply.id)).toEqual([
      'reply-1',
      'local-1',
    ])
  })

  it('drops an unsent reply the fetch shows was saved after all', () => {
    const fetched = [{ id: 'reply-2', content: 'hello', created_at: 101, created_by: 'user-1' }]
    expect(
      mergeFetchedReplies([local({}), local({ id: 'local-2', send_state: 'pending' })], fetched),
    ).toEqual(fetched)
  })

  it('keeps an unsent reply when only an older or someone else’s reply has the same text', () => {
    const fetched = [
      { id: 'reply-old', content: 'hello', created_at: 10, created_by: 'user-1' },
      { id: 'reply-bob', content: 'hello', created_at: 101, created_by: 'user-2' },
    ]
    expect(mergeFetchedReplies([local({})], fetched).map((reply) => reply.id)).toContain('local-1')
  })

  it('keeps the rendered key of a reply that took its server id', () => {
    const current = [{ ...local({ send_state: undefined }), id: 'reply-3' }]
    const fetched = [{ id: 'reply-3', content: 'hello', created_at: 100, created_by: 'user-1' }]
    expect(mergeFetchedReplies(current, fetched)[0]).toMatchObject({
      id: 'reply-3',
      client_key: 'local-1',
    })
  })
})
