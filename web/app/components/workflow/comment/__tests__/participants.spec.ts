import { getCommentParticipants, toCommentCollaborator } from '../participants'

const ann = { id: 'ann', name: 'Ann', email: 'ann@example.com', avatar_url: null }
const bob = {
  id: 'bob',
  name: 'Bob',
  email: 'bob@example.com',
  avatar_url: 'https://example.com/bob.png',
}

describe('comment participants', () => {
  it('shows a comment account as a collaborator, colored by their id like anyone else', () => {
    expect(toCommentCollaborator(ann)).toEqual({ id: 'ann', name: 'Ann', avatarUrl: null })
  })

  it('lists the author first, then each other participant once', () => {
    const participants = getCommentParticipants({
      created_by_account: bob,
      participants: [ann, bob, ann],
    })

    expect(participants.map((person) => person.id)).toEqual(['bob', 'ann'])
  })
})
