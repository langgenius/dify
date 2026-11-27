'use client'

import type { LoroDoc } from 'loro-crdt'
import type { Socket } from 'socket.io-client'
import { decodeImportBlobMeta } from 'loro-crdt'
import { emitWithAuthGuard } from './websocket-manager'

export class CRDTProvider {
  private doc: LoroDoc
  private socket: Socket
  private onUnauthorized?: () => void
  private onSnapshotImported?: () => void
  private shouldImportSnapshot?: () => boolean
  private unsubscribeDoc?: () => void

  constructor(
    socket: Socket,
    doc: LoroDoc,
    onUnauthorized?: () => void,
    onSnapshotImported?: () => void,
    shouldImportSnapshot?: () => boolean,
  ) {
    this.socket = socket
    this.doc = doc
    this.onUnauthorized = onUnauthorized
    this.onSnapshotImported = onSnapshotImported
    this.shouldImportSnapshot = shouldImportSnapshot
    this.setupEventListeners()
  }

  private setupEventListeners(): void {
    const unsubscribe = this.doc.subscribe((event: { by?: string }) => {
      if (event.by === 'local') {
        if (!this.socket.connected) return

        const update = this.doc.export({ mode: 'update' })
        emitWithAuthGuard(this.socket, 'graph_event', update, {
          onUnauthorized: this.onUnauthorized,
        })
      }
    })
    if (typeof unsubscribe === 'function') this.unsubscribeDoc = unsubscribe

    this.socket.on('graph_update', this.handleGraphUpdate)
  }

  private handleGraphUpdate = (updateData: Uint8Array): void => {
    try {
      const data = new Uint8Array(updateData)
      let isSnapshot = false
      try {
        const metadata = decodeImportBlobMeta(data, false)
        isSnapshot = metadata.mode === 'snapshot' || metadata.mode === 'outdated-snapshot'
      } catch {
        // Import remains backward compatible with payloads whose metadata cannot be decoded.
      }

      if (isSnapshot && this.shouldImportSnapshot?.() === false) return

      this.doc.import(data)
      if (isSnapshot) this.onSnapshotImported?.()
    } catch (error) {
      console.error('Error importing graph update:', error)
    }
  }

  destroy(): void {
    this.unsubscribeDoc?.()
    this.unsubscribeDoc = undefined
    this.socket.off('graph_update', this.handleGraphUpdate)
  }
}
