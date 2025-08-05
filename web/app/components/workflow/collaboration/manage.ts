import { LoroDoc } from 'loro-crdt'
import { isEqual } from 'lodash-es'
import { type WebSocketInstance, useWebSocketStore } from '../store/websocket-store'
import type { Edge, Node } from '../types'

class LoroSocketIOProvider {
  private doc: LoroDoc
  private socket: WebSocketInstance

  constructor(socket: WebSocketInstance, doc: LoroDoc) {
    this.socket = socket
    this.doc = doc
    this.setupEventListeners()
  }

  private setupEventListeners() {
    this.doc.subscribe((event: any) => {
      if (event.by === 'local') {
        const update = this.doc.export({ mode: 'update' })
        this.socket.emit('graph_event', update)
      }
    })

    this.socket.on('graph_update', (updateData: Uint8Array) => {
      try {
        const data = new Uint8Array(updateData)
        this.doc.import(data)
      }
      catch (error) {
        console.error('Error importing graph update:', error)
      }
    })
  }

  destroy() {
    this.socket.off('graph_update')
  }
}

class CollaborationManager {
  private doc: LoroDoc | null = null
  private provider: LoroSocketIOProvider | null = null
  private nodesMap: any = null
  private edgesMap: any = null

  init(appId: string, reactFlowStore: any) {
    const { getSocket } = useWebSocketStore.getState()
    const socket = getSocket(appId)
    this.doc = new LoroDoc()
    this.nodesMap = this.doc.getMap('nodes')
    this.edgesMap = this.doc.getMap('edges')
    this.provider = new LoroSocketIOProvider(socket, this.doc)

    this.setupSubscriptions(reactFlowStore)
  }

  private setupSubscriptions(reactFlowStore: any) {
    this.nodesMap?.subscribe((event: any) => {
      console.log('nodesMap', event)
      if (event.by === 'import') {
        requestAnimationFrame(() => {
          const { setNodes: reactFlowSetNodes } = reactFlowStore.getState()
          const updatedNodes = Array.from(this.nodesMap.values())
          reactFlowSetNodes(updatedNodes)
        })
      }
    })

    this.edgesMap?.subscribe((event: any) => {
      if (event.by === 'import') {
        requestAnimationFrame(() => {
          const { setEdges: reactFlowSetEdges } = reactFlowStore.getState()
          const updatedEdges = Array.from(this.edgesMap.values())
          reactFlowSetEdges(updatedEdges)
        })
      }
    })
  }

  getNodes() {
    return this.nodesMap ? Array.from(this.nodesMap.values()) : []
  }

  getEdges() {
    return this.edgesMap ? Array.from(this.edgesMap.values()) : []
  }

  private getPersistentNodeData = (node: Node) => {
      const { data, ...rest } = node
      const filteredData = Object.fromEntries(
        Object.entries(data).filter(([key]) => !key.startsWith('_')),
      )
      return { ...rest, data: filteredData }
    }

  setNodes = (oldNodes: Node[], newNodes: Node[]) => {
    if (!this.nodesMap || !this.doc) return

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

    this.doc.commit()
  }

  setEdges = (oldEdges: Edge[], newEdges: Edge[]) => {
    if (!this.edgesMap || !this.doc) return

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

    this.doc.commit()
  }

  destroy() {
    this.provider?.destroy()
    this.doc = null
    this.provider = null
    this.nodesMap = null
    this.edgesMap = null
  }
}

export const collaborationManager = new CollaborationManager()
