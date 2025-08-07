import { LoroDoc } from 'loro-crdt'
import { isEqual } from 'lodash-es'
import { webSocketClient } from './websocket-manager'
import { CRDTProvider } from './crdt-provider'
import { EventEmitter } from './event-emitter'
import type { Edge, Node } from '../../types'
import type { CollaborationState, CursorPosition, OnlineUser } from '../types/collaboration'

export class CollaborationManager {
  private doc: LoroDoc | null = null
  private provider: CRDTProvider | null = null
  private nodesMap: any = null
  private edgesMap: any = null
  private eventEmitter = new EventEmitter()
  private currentAppId: string | null = null
  private reactFlowStore: any = null

  init = (appId: string, reactFlowStore: any): void => {
    this.connect(appId, reactFlowStore)
  }

  setNodes = (oldNodes: Node[], newNodes: Node[]): void => {
    this.syncNodes(oldNodes, newNodes)
    if (this.doc)
      this.doc.commit()
  }

  setEdges = (oldEdges: Edge[], newEdges: Edge[]): void => {
    this.syncEdges(oldEdges, newEdges)
    if (this.doc)
      this.doc.commit()
  }

  destroy = (): void => {
    this.disconnect()
  }

  async connect(appId: string, reactFlowStore: any): Promise<void> {
    if (this.currentAppId === appId && this.doc) return

    this.disconnect()

    this.currentAppId = appId
    this.reactFlowStore = reactFlowStore

    const socket = webSocketClient.connect(appId)
    this.doc = new LoroDoc()
    this.nodesMap = this.doc.getMap('nodes')
    this.edgesMap = this.doc.getMap('edges')
    this.provider = new CRDTProvider(socket, this.doc)

    this.setupSubscriptions()
    this.setupSocketEventListeners(socket)
  }

  disconnect = (): void => {
    if (this.currentAppId)
      webSocketClient.disconnect(this.currentAppId)

    this.provider?.destroy()
    this.doc = null
    this.provider = null
    this.nodesMap = null
    this.edgesMap = null
    this.currentAppId = null
    this.reactFlowStore = null
    this.eventEmitter.removeAllListeners()
  }

  isConnected(): boolean {
    return this.currentAppId ? webSocketClient.isConnected(this.currentAppId) : false
  }

  getNodes(): Node[] {
    return this.nodesMap ? Array.from(this.nodesMap.values()) : []
  }

  getEdges(): Edge[] {
    return this.edgesMap ? Array.from(this.edgesMap.values()) : []
  }

  emitCursorMove(position: CursorPosition): void {
    if (!this.currentAppId || !webSocketClient.isConnected(this.currentAppId)) return

    const socket = webSocketClient.getSocket(this.currentAppId)
    if (socket) {
      socket.emit('collaboration_event', {
        type: 'mouseMove',
        userId: socket.id,
        data: { x: position.x, y: position.y },
        timestamp: Date.now(),
      })
    }
  }

  onStateChange(callback: (state: Partial<CollaborationState>) => void): () => void {
    return this.eventEmitter.on('stateChange', callback)
  }

  onCursorUpdate(callback: (cursors: Record<string, CursorPosition>) => void): () => void {
    return this.eventEmitter.on('cursors', callback)
  }

  onOnlineUsersUpdate(callback: (users: OnlineUser[]) => void): () => void {
    return this.eventEmitter.on('onlineUsers', callback)
  }

  onVarsAndFeaturesUpdate(callback: (update: any) => void): () => void {
    return this.eventEmitter.on('varsAndFeaturesUpdate', callback)
  }

  private syncNodes(oldNodes: Node[], newNodes: Node[]): void {
    if (!this.nodesMap) return

    const oldNodesMap = new Map(oldNodes.map(node => [node.id, node]))
    const newNodesMap = new Map(newNodes.map(node => [node.id, node]))

    oldNodes.forEach((oldNode) => {
      if (!newNodesMap.has(oldNode.id))
        this.nodesMap.delete(oldNode.id)
    })

    newNodes.forEach((newNode) => {
      const oldNode = oldNodesMap.get(newNode.id)
      if (!oldNode) {
        this.nodesMap.set(newNode.id, newNode)
      }
 else {
        const oldPersistentData = this.getPersistentNodeData(oldNode)
        const newPersistentData = this.getPersistentNodeData(newNode)
        if (!isEqual(oldPersistentData, newPersistentData))
          this.nodesMap.set(newNode.id, newPersistentData)
      }
    })
  }

  private syncEdges(oldEdges: Edge[], newEdges: Edge[]): void {
    if (!this.edgesMap) return

    const oldEdgesMap = new Map(oldEdges.map(edge => [edge.id, edge]))
    const newEdgesMap = new Map(newEdges.map(edge => [edge.id, edge]))

    oldEdges.forEach((oldEdge) => {
      if (!newEdgesMap.has(oldEdge.id))
        this.edgesMap.delete(oldEdge.id)
    })

    newEdges.forEach((newEdge) => {
      const oldEdge = oldEdgesMap.get(newEdge.id)
      if (!oldEdge)
        this.edgesMap.set(newEdge.id, newEdge)
       else if (!isEqual(oldEdge, newEdge))
        this.edgesMap.set(newEdge.id, newEdge)
    })
  }

  private getPersistentNodeData(node: Node): any {
    const { data, ...rest } = node
    const filteredData = Object.fromEntries(
      Object.entries(data).filter(([key]) => !key.startsWith('_')),
    )
    return { ...rest, data: filteredData }
  }

  private setupSubscriptions(): void {
    this.nodesMap?.subscribe((event: any) => {
      if (event.by === 'import' && this.reactFlowStore) {
        requestAnimationFrame(() => {
          const { setNodes } = this.reactFlowStore.getState()
          const updatedNodes = Array.from(this.nodesMap.values())
          setNodes(updatedNodes)
        })
      }
    })

    this.edgesMap?.subscribe((event: any) => {
      if (event.by === 'import' && this.reactFlowStore) {
        requestAnimationFrame(() => {
          const { setEdges } = this.reactFlowStore.getState()
          const updatedEdges = Array.from(this.edgesMap.values())
          setEdges(updatedEdges)
        })
      }
    })
  }

  private setupSocketEventListeners(socket: any): void {
    socket.on('collaboration_update', (update: any) => {
      if (update.type === 'mouseMove') {
        this.eventEmitter.emit('cursors', {
          [update.userId]: {
            x: update.data.x,
            y: update.data.y,
            userId: update.userId,
            timestamp: update.timestamp,
          },
        })
      }
 else if (update.type === 'varsAndFeaturesUpdate') {
        this.eventEmitter.emit('varsAndFeaturesUpdate', update)
      }
    })

    socket.on('online_users', (data: { users: OnlineUser[] }) => {
      this.eventEmitter.emit('onlineUsers', data.users)
    })

    socket.on('connect', () => {
      this.eventEmitter.emit('stateChange', { isConnected: true })
    })

    socket.on('disconnect', () => {
      this.eventEmitter.emit('stateChange', { isConnected: false })
    })
  }
}

export const collaborationManager = new CollaborationManager()
