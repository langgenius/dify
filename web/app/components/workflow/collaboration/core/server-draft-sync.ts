import type { Socket } from 'socket.io-client'
import type { Edge, Node } from '../../types'
import { emitWithAuthGuard } from './websocket-manager'

export type ServerDraftGraph = { nodes: Node[]; edges: Edge[] }
export type ServerDraftChange = {
  revision: string
  hash: string
  updated_at: number
  graph: ServerDraftGraph
  previous_graph: ServerDraftGraph | null
  base_update: string | null
}
export type ServerDraftUpdate = Pick<ServerDraftChange, 'revision' | 'hash' | 'updated_at'> & {
  update: Uint8Array
}

/** A server accepts one proposal; browsers never publish their speculative fork. */
export class ServerDraftSync {
  private appliedRevision = ''
  private lastUpdate: ServerDraftUpdate | null = null
  private requiredRevision = ''
  private disposed = false
  private inFlight: Promise<ServerDraftUpdate> | null = null
  private cancelRequest?: () => void
  private retryTimer?: ReturnType<typeof setTimeout>
  private retryAttempt = 0
  private socket: Socket
  private prepare: (change: ServerDraftChange) => Uint8Array | null
  private apply: (update: ServerDraftUpdate) => void
  private setPending: (pending: boolean) => void
  private onUnauthorized: () => void

  constructor(
    socket: Socket,
    prepare: (change: ServerDraftChange) => Uint8Array | null,
    apply: (update: ServerDraftUpdate) => void,
    setPending: (pending: boolean) => void,
    onUnauthorized: () => void,
  ) {
    this.socket = socket
    this.prepare = prepare
    this.apply = apply
    this.setPending = setPending
    this.onUnauthorized = onUnauthorized
    socket.on('server_draft_changed', this.handleChanged)
    socket.on('server_draft_request', this.handleRequest)
    socket.on('server_draft_update', this.handleUpdate)
  }

  private handleChanged = ({ revision }: { revision: string }) => {
    if (revision <= this.appliedRevision) return
    this.requiredRevision = revision > this.requiredRevision ? revision : this.requiredRevision
    this.setPending(true)
    this.synchronize()
  }

  private handleRequest = (
    change: ServerDraftChange,
    acknowledge: (proposal: { revision: string; update: Uint8Array } | { error: string }) => void,
  ) => {
    try {
      const update = this.prepare(change)
      acknowledge(update ? { revision: change.revision, update } : { error: 'graph_not_ready' })
    } catch {
      acknowledge({ error: 'graph_not_ready' })
    }
  }

  private handleUpdate = (update: ServerDraftUpdate) => {
    if (this.disposed || update.revision <= this.appliedRevision) return
    this.apply(update)
    this.appliedRevision = update.revision
    this.lastUpdate = update
    if (this.appliedRevision < this.requiredRevision) return
    this.retryAttempt = 0
    clearTimeout(this.retryTimer)
    this.retryTimer = undefined
    this.setPending(false)
  }

  private synchronize = () => {
    const retryIfPending = () => {
      if (this.disposed || this.appliedRevision >= this.requiredRevision || this.retryTimer) return
      this.retryTimer = setTimeout(
        () => {
          this.retryTimer = undefined
          this.synchronize()
        },
        Math.min(1000 * 2 ** this.retryAttempt++, 10_000),
      )
    }
    void this.request().then(retryIfPending, retryIfPending)
  }

  request(): Promise<ServerDraftUpdate> {
    if (this.disposed || !this.socket.connected)
      return Promise.reject(new Error('Collaboration connection is not available.'))
    if (this.inFlight) return this.inFlight

    const request = new Promise<ServerDraftUpdate>((resolve, reject) => {
      let settled = false
      let retry: ReturnType<typeof setTimeout> | undefined
      const timeout = setTimeout(() => {
        settled = true
        clearTimeout(retry)
        reject(new Error('Server draft sync timed out.'))
      }, 20_000)
      this.cancelRequest = () => {
        settled = true
        clearTimeout(timeout)
        clearTimeout(retry)
        reject(new Error('Collaboration connection closed.'))
      }
      const send = () =>
        emitWithAuthGuard(
          this.socket,
          'server_draft_sync',
          {},
          {
            onUnauthorized: this.onUnauthorized,
            onAck: (body: unknown, status: unknown) => {
              if (this.disposed || settled) return
              if (status === 202 || status === 409 || status === 503) {
                retry = setTimeout(send, 1000)
                return
              }
              settled = true
              clearTimeout(timeout)
              if (status !== 200) {
                reject(new Error('Server draft sync is not ready.'))
                return
              }
              const update = body as ServerDraftUpdate
              try {
                this.handleUpdate(update)
                resolve(this.lastUpdate ?? update)
              } catch (error) {
                reject(error)
              }
            },
          },
        )
      send()
    }).finally(() => {
      this.inFlight = null
      this.cancelRequest = undefined
    })
    this.inFlight = request
    return request
  }

  destroy(): void {
    this.disposed = true
    clearTimeout(this.retryTimer)
    this.cancelRequest?.()
    this.socket.off('server_draft_changed', this.handleChanged)
    this.socket.off('server_draft_request', this.handleRequest)
    this.socket.off('server_draft_update', this.handleUpdate)
  }
}
