import { EventEmitter } from '../event-emitter'
import { PresenceManager } from '../presence-manager'

it('retains presence for active collaborators and removes it when they leave', () => {
  const presence = new PresenceManager(new EventEmitter())
  const user = { user_id: 'user-1', username: 'Alex', avatar: '', sid: 'tab-1' }
  presence.updateUsers([user])
  presence.move({ type: 'mouse_move', userId: user.user_id, data: { x: 1, y: 2 }, timestamp: 1000 })
  presence.applyNodePanelPresenceUpdate({
    nodeId: 'node-1',
    action: 'open',
    clientId: user.sid,
    user: { userId: user.user_id, username: user.username },
    timestamp: 1000,
  })
  expect(presence.getOnlineUsers()).toEqual([user])
  expect(presence.getCursors()).toEqual({ 'user-1': expect.objectContaining({ x: 1, y: 2 }) })
  expect(presence.getNodePanelPresenceSnapshot()).toEqual({
    'node-1': { 'tab-1': expect.objectContaining({ username: 'Alex' }) },
  })

  presence.updateUsers([])
  expect(presence.getOnlineUsers()).toEqual([])
  expect(presence.getCursors()).toEqual({})
  expect(presence.getNodePanelPresenceSnapshot()).toEqual({})
})
