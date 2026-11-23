import type { NodePanelPresenceMap } from '../../types/collaboration'
import { getNodeEditors } from '../node-editors'
import { getUserColor } from '../user-color'

const presence: NodePanelPresenceMap = {
  llm: {
    'client-me': { clientId: 'client-me', userId: 'me', username: 'Me', timestamp: 40 },
    'client-ann-1': { clientId: 'client-ann-1', userId: 'ann', username: 'Ann', timestamp: 10 },
    'client-bob': {
      clientId: 'client-bob',
      userId: 'bob',
      username: 'Bob',
      avatar: 'bob.png',
      timestamp: 20,
    },
    'client-ann-2': { clientId: 'client-ann-2', userId: 'ann', username: 'Ann', timestamp: 30 },
  },
}

it('lists other editors once each, latest entry first, in their collaboration color', () => {
  expect(getNodeEditors(presence, 'llm', 'me')).toEqual([
    { id: 'ann', name: 'Ann', avatarUrl: null, color: getUserColor('ann') },
    { id: 'bob', name: 'Bob', avatarUrl: 'bob.png', color: getUserColor('bob') },
  ])
})

it('returns no editors for a node nobody else has open', () => {
  expect(getNodeEditors(presence, 'start', 'me')).toEqual([])
  expect(getNodeEditors(undefined, 'llm', 'me')).toEqual([])
})
