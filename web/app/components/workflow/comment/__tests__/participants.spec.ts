import { getUserColor } from '../../collaboration/utils/user-color'
import { getCommentParticipants, toCommentCollaborator } from '../participants'

const ann = { id: 'ann', name: 'Ann', email: 'ann@example.com', avatar_url: null }
const bob = {
  id: 'bob',
  name: 'Bob',
  email: 'bob@example.com',
  avatar_url: 'https://example.com/bob.png',
}

describe('comment participants', () => {
  it('gives everyone the color of their id, so each person looks the same to every viewer', () => {
    expect(toCommentCollaborator(ann)).toEqual({
      id: 'ann',
      name: 'Ann',
      avatarUrl: null,
      color: getUserColor('ann'),
    })
  })

  it('lists the author first, then each other participant once', () => {
    const participants = getCommentParticipants({
      created_by_account: bob,
      participants: [ann, bob, ann],
    })

    expect(participants.map((person) => person.id)).toEqual(['bob', 'ann'])
  })
})
