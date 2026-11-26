'use client'

import type { LoroDoc } from 'loro-crdt'
import type { Socket } from 'socket.io-client'
import { decodeImportBlobMeta } from 'loro-crdt'
import { emitWithAuthGuard } from './websocket-manager'

type CRDTProviderCallbacks = {
  onUnauthorized?: () => void
  onSnapshotImported?: () => void
  shouldImportSnapshot?: () => boolean
  /** An update was stored but waits for operations this replica has not received. */
  onMissingDependencies?: () => void
  /** Loro rejected an incoming update, so this replica may no longer match its peers. */
  onImportFailed?: (error: unknown) => void
}

/**
 * Relays Loro updates over the collaboration socket.
 *
 * Outbound: each local commit sends only the bytes of that commit (`subscribeLocalUpdates`).
 * Inbound: an update counts as integrated only when `ImportStatus.pending` is empty; otherwise the
 * caller recovers the missing range. Saving is a separate step that the collaboration manager
 * acknowledges with the persisted draft hash.
 */
export class CRDTProvider {
  private doc: LoroDoc
  private socket: Socket
  private callbacks: CRDTProviderCallbacks
  private unsubscribeLocalUpdates?: () => void

  constructor(socket: Socket, doc: LoroDoc, callbacks: CRDTProviderCallbacks = {}) {
    this.socket = socket
    this.doc = doc
    this.callbacks = callbacks
    this.unsubscribeLocalUpdates = this.doc.subscribeLocalUpdates(this.handleLocalUpdate)
    this.socket.on('graph_update', this.handleGraphUpdate)
  }

  private handleLocalUpdate = (update: Uint8Array): void => {
    if (!this.socket.connected) return

    emitWithAuthGuard(this.socket, 'graph_event', update, {
      onUnauthorized: this.callbacks.onUnauthorized,
    })
  }

  private handleGraphUpdate = (updateData: Uint8Array): void => {
    const data = new Uint8Array(updateData)
    let isSnapshot = false
    try {
      const metadata = decodeImportBlobMeta(data, false)
      isSnapshot = metadata.mode === 'snapshot' || metadata.mode === 'outdated-snapshot'
    } catch {
      // `import` reports undecodable payloads below.
    }

    if (isSnapshot && this.callbacks.shouldImportSnapshot?.() === false) return

    let status: ReturnType<LoroDoc['import']>
    try {
      status = this.doc.import(data)
    } catch (error) {
      this.callbacks.onImportFailed?.(error)
      return
    }

    if (status.pending && status.pending.size > 0) this.callbacks.onMissingDependencies?.()
    else if (isSnapshot) this.callbacks.onSnapshotImported?.()
  }

  destroy(): void {
    this.unsubscribeLocalUpdates?.()
    this.unsubscribeLocalUpdates = undefined
    this.socket.off('graph_update', this.handleGraphUpdate)
  }
}
