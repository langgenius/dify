import { create } from 'zustand'

import { LoroDoc } from 'loro-crdt'
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
