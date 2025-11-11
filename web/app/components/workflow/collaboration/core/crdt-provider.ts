import type { LoroDoc } from 'loro-crdt'
import type { Socket } from 'socket.io-client'
import { emitWithAuthGuard } from './websocket-manager'

export class CRDTProvider {
  private doc: LoroDoc
  private socket: Socket
  private onUnauthorized?: () => void

  constructor(socket: Socket, doc: LoroDoc, onUnauthorized?: () => void) {
    this.socket = socket
    this.doc = doc
    this.onUnauthorized = onUnauthorized
    this.setupEventListeners()
  }

  private setupEventListeners(): void {
    this.doc.subscribe((event: any) => {
      if (event.by === 'local') {
        const update = this.doc.export({ mode: 'update' })
        emitWithAuthGuard(this.socket, 'graph_event', update, { onUnauthorized: this.onUnauthorized })
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
