import { create } from 'zustand'
import * as Y from 'yjs'
import type { Edge, Node } from '../types'
import { useWebSocketStore } from './websocket-store'

let globalYDoc: Y.Doc | null = null
let globalYNodesMap: Y.Map<any> | null = null
let globalYEdgesMap: Y.Map<any> | null = null

class YjsSocketIOProvider {
  private doc: Y.Doc
  private socket: any
  private isDestroyed = false
  private onRemoteUpdate?: () => void

  constructor(socket: any, doc: Y.Doc, onRemoteUpdate?: () => void) {
    this.socket = socket
    this.doc = doc
    this.onRemoteUpdate = onRemoteUpdate

    this.setupEventListeners()
  }

  private setupEventListeners() {
    this.doc.on('update', (update: Uint8Array, origin: any) => {
      if (origin !== 'remote')
        this.socket.emit('yjs_update', update)
    })

    this.socket.on('yjs_update', (updateData: Uint8Array) => {
      Y.applyUpdate(this.doc, new Uint8Array(updateData), 'remote')

      if (this.onRemoteUpdate)
        this.onRemoteUpdate()
    })
  }

  destroy() {
    this.isDestroyed = true
  }
}

type CollaborationStore = {
  ydoc: Y.Doc | null
  provider: YjsSocketIOProvider | null

  yNodesMap: Y.Map<any> | null
  yEdgesMap: Y.Map<any> | null

  yTestMap: Y.Map<any> | null
  yTestArray: Y.Array<any> | null

  nodes: Node[]
  edges: Edge[]

  initCollaboration: (appId: string) => void
  destroyCollaboration: () => void

}

export const useCollaborationStore = create<CollaborationStore>((set, get) => ({
  ydoc: null,
  provider: null,
  yNodesMap: null,
  yEdgesMap: null,
  yTestMap: null,
  yTestArray: null,
  nodes: [],
  edges: [],

  initCollaboration: (appId: string) => {
    if (!globalYDoc) {
      console.log('Creating new global Y.Doc instance')
      globalYDoc = new Y.Doc()
      globalYNodesMap = globalYDoc.getMap<any>('nodes')
      globalYEdgesMap = globalYDoc.getMap<any>('edges')
    }
 else {
      console.log('Reusing existing global Y.Doc instance')
    }
    const ydoc = globalYDoc
    const yNodesMap = globalYNodesMap!
    const yEdgesMap = globalYEdgesMap!

    const { getSocket } = useWebSocketStore.getState()
    const socket = getSocket(appId)

    const updateReactState = () => {
      console.log('updateReactState called')

      const nodes = Array.from(yNodesMap.values())
      const edges = Array.from(yEdgesMap.values())
      console.log('Y.js data - nodes:', nodes.length, 'edges:', edges.length)

      set({
        nodes: [...nodes] as Node[],
        edges: [...edges] as Edge[],
      })
    }

    const provider = new YjsSocketIOProvider(socket, globalYDoc, updateReactState)

    yNodesMap.observe((event) => {
      console.log('yNodesMap changed:', event)
      updateReactState()
    })
    yEdgesMap.observe((event) => {
      console.log('yEdgesMap changed:', event)
      updateReactState()
    })

    updateReactState()

    set({
      ydoc,
      provider,
      yNodesMap,
      yEdgesMap,
    })
  },

  destroyCollaboration: () => {
    const { provider } = get()
    provider?.destroy()
    set({
      ydoc: null,
      provider: null,
      yNodesMap: null,
      yEdgesMap: null,
    })
  },
}))
