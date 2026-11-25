import type {
  CollaborationUpdate,
  CursorPosition,
  NodePanelPresenceMap,
  NodePanelPresenceUser,
  OnlineUser,
} from '../types/collaboration'
import type { EventEmitter } from './event-emitter'
export type NodePanelPresenceEventData = {
  nodeId: string
  action: 'open' | 'close'
  user: NodePanelPresenceUser
  clientId: string
  timestamp: number
}

export class PresenceManager {
  private nodePanelPresence: NodePanelPresenceMap = {}
  private cursors: Record<string, CursorPosition> = {}
  private onlineUsers: OnlineUser[] = []
  private eventEmitter: EventEmitter
  constructor(eventEmitter: EventEmitter) {
    this.eventEmitter = eventEmitter
  }

  getCursors() {
    return { ...this.cursors }
  }

  getOnlineUsers() {
    return [...this.onlineUsers]
  }

  move(update: CollaborationUpdate) {
    const { x, y } = update.data
    if (typeof x !== 'number' || typeof y !== 'number') return
    this.cursors[update.userId] = { x, y, timestamp: update.timestamp, userId: update.userId }
    this.eventEmitter.emit('cursors', this.getCursors())
  }

  updateUsers(users: OnlineUser[]) {
    this.onlineUsers = users
    const online = new Set(users.map((user) => user.user_id))
    for (const user of Object.keys(this.cursors)) if (!online.has(user)) delete this.cursors[user]
    this.cleanupNodePanelPresence(new Set(users.map((user) => user.sid)))
    this.eventEmitter.emit('onlineUsers', users)
    this.eventEmitter.emit('cursors', this.getCursors())
  }
  getNodePanelPresenceSnapshot(): NodePanelPresenceMap {
    const snapshot: NodePanelPresenceMap = {}
    Object.entries(this.nodePanelPresence).forEach(([nodeId, viewers]) => {
      snapshot[nodeId] = { ...viewers }
    })
    return snapshot
  }

  applyNodePanelPresenceUpdate(update: NodePanelPresenceEventData): void {
    const { nodeId, action, clientId, user, timestamp } = update

    if (action === 'open') {
      // ensure a client only appears on a single node at a time
      Object.entries(this.nodePanelPresence).forEach(([id, viewers]) => {
        if (viewers[clientId]) {
          delete viewers[clientId]
          if (Object.keys(viewers).length === 0) delete this.nodePanelPresence[id]
        }
      })

      if (!this.nodePanelPresence[nodeId]) this.nodePanelPresence[nodeId] = {}

      this.nodePanelPresence[nodeId][clientId] = {
        ...user,
        clientId,
        timestamp: timestamp || Date.now(),
      }
    } else {
      const viewers = this.nodePanelPresence[nodeId]
      if (viewers) {
        delete viewers[clientId]
        if (Object.keys(viewers).length === 0) delete this.nodePanelPresence[nodeId]
      }
    }

    this.eventEmitter.emit('nodePanelPresence', this.getNodePanelPresenceSnapshot())
  }

  private cleanupNodePanelPresence(activeClientIds: Set<string>): void {
    let hasChanges = false

    Object.entries(this.nodePanelPresence).forEach(([nodeId, viewers]) => {
      Object.keys(viewers).forEach((clientId) => {
        const clientActive = activeClientIds.has(clientId)

        if (!clientActive) {
          delete viewers[clientId]
          hasChanges = true
        }
      })

      if (Object.keys(viewers).length === 0) delete this.nodePanelPresence[nodeId]
    })

    if (hasChanges) this.eventEmitter.emit('nodePanelPresence', this.getNodePanelPresenceSnapshot())
  }
}
