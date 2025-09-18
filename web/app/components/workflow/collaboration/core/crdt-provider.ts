import type { LoroDoc } from 'loro-crdt'
import type { Socket } from 'socket.io-client'

export class CRDTProvider {
  private doc: LoroDoc
  private socket: Socket

  constructor(socket: Socket, doc: LoroDoc) {
    this.socket = socket
    this.doc = doc
    this.setupEventListeners()
  }

  private setupEventListeners(): void {
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

  destroy(): void {
    this.socket.off('graph_update')
  }
}
