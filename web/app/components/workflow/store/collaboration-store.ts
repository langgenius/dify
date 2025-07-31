import { create } from 'zustand'

import { LoroDoc } from 'loro-crdt'
import { isEqual } from 'lodash-es'
import type { Edge, Node } from '../types'
import { useWebSocketStore } from './websocket-store'

class LoroSocketIOProvider {
  private doc: any
  private socket: any

  constructor(socket: any, doc: any) {
    this.socket = socket
    this.doc = doc

    this.setupEventListeners()
  }

  private setupEventListeners() {
    this.doc.subscribe((event: any) => {
      if (event.origin !== 'remote') {
        const update = this.doc.export({ mode: 'update' })
        this.socket.emit('graph_update', update)
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

type CollaborationStore = {
  loroDoc: any | null
  provider: LoroSocketIOProvider | null
  nodesMap: any | null
  edgesMap: any | null
  nodes: Node[]
  edges: Edge[]
  updateNodes?: () => void
  updateEdges?: () => void

  setNodes: (newNodes: Node[]) => void
  setEdges: (newEdges: Edge[]) => void
  initCollaboration: (appId: string) => void
  destroyCollaboration: () => void
}

export const useCollaborationStore = create<CollaborationStore>((set, get) => ({
  loroDoc: null,
  provider: null,
  nodesMap: null,
  edgesMap: null,
  nodes: [],
  edges: [],

  setNodes: (newNodes: Node[]) => {
    const { nodes: oldNodes, nodesMap, loroDoc } = get()

    const oldNodesMap = new Map(oldNodes.map(node => [node.id, node]))
    const newNodesMap = new Map(newNodes.map(node => [node.id, node]))

    const getPersistentNodeData = (node: Node) => {
    const { data, ...rest } = node
    const filteredData = Object.fromEntries(
      Object.entries(data).filter(([key]) =>
        !key.startsWith('_') && key !== 'selected',
      ),
    )

      return {
        ...rest,
        data: filteredData,
      }
    }

    // delete
    oldNodes.forEach((oldNode) => {
      if (!newNodesMap.has(oldNode.id))
        nodesMap.delete(oldNode.id)
    })

    newNodes.forEach((newNode) => {
      const oldNode = oldNodesMap.get(newNode.id)
      if (!oldNode) {
        // add
        nodesMap.set(newNode.id, newNode)
      }
      else {
        const oldPersistentData = getPersistentNodeData(oldNode)
        const newPersistentData = getPersistentNodeData(newNode)

        if (!isEqual(oldPersistentData, newPersistentData)) {
          // update
          nodesMap.set(newNode.id, newNode)
        }
      }
    })
    loroDoc.commit()
  },

  setEdges: (newEdges: Edge[]) => {
    const { edges: oldEdges, edgesMap, loroDoc } = get()

    const oldEdgesMap = new Map(oldEdges.map(edge => [edge.id, edge]))
    const newEdgesMap = new Map(newEdges.map(edge => [edge.id, edge]))

    // delete
    oldEdges.forEach((oldEdge) => {
      if (!newEdgesMap.has(oldEdge.id))
        edgesMap.delete(oldEdge.id)
    })

    newEdges.forEach((newEdge) => {
      const oldEdge = oldEdgesMap.get(newEdge.id)
      if (!oldEdge) {
        // add
        edgesMap.set(newEdge.id, newEdge)
      }
 else if (!isEqual(oldEdge, newEdge)) {
        // update
        edgesMap.set(newEdge.id, newEdge)
      }
    })

    loroDoc.commit()
  },

  initCollaboration: (appId: string) => {
    const { getSocket } = useWebSocketStore.getState()
    const socket = getSocket(appId)
    const doc = new LoroDoc()
    const nodesMap = doc.getMap('nodes')
    const edgesMap = doc.getMap('edges')

    const updateNodes = () => {
      const nodes = Array.from(nodesMap.values())
      set({ nodes })
    }

    const updateEdges = () => {
      const edges = Array.from(edgesMap.values())
      set({ edges })
    }

    const provider = new LoroSocketIOProvider(socket, doc)

    set({
      loroDoc: doc,
      provider,
      nodesMap,
      edgesMap,
      nodes: [],
      edges: [],
      updateNodes,
      updateEdges,
    })

    nodesMap.subscribe((event: any) => {
      console.log('NodesMap changed:', event)
      updateNodes()
    })

    edgesMap.subscribe((event: any) => {
      console.log('EdgesMap changed:', event)
      updateEdges()
    })
  },

  destroyCollaboration: () => {
    const { provider } = get()
    if (provider) {
      provider.destroy()
      set({
        loroDoc: null,
        provider: null,
        nodesMap: null,
        edgesMap: null,
        nodes: [],
        edges: [],
      })
    }
  },
}))
