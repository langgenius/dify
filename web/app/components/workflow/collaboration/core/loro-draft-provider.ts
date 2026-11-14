import type { Socket } from 'socket.io-client'
import type { WorkflowSyncResult } from '../types/collaboration'
import type { LoroDraftEdit, LoroDraftRetirement } from './loro-draft-storage'
import { decodeImportBlobMeta, LoroDoc, VersionVector } from 'loro-crdt'
import { LoroDraftStorage } from './loro-draft-storage'

export type LoroDraftIdentity = Readonly<{ epoch: string; accountId: string }>
export type LoroDraftConfirmation = WorkflowSyncResult & {
  isEmpty: boolean
  cleanup?: 'cleared' | 'failed'
}

type Options = {
  appId: string
  identity: LoroDraftIdentity
  retirements?: readonly LoroDraftRetirement[]
  doc: LoroDoc
  socket: Socket
  isEmpty: () => boolean
  onReady: () => void
  onConfirmed: (result: LoroDraftConfirmation) => void
  onPendingChange: (pending: boolean) => void
  onEpochChanged: () => void
  onUnavailable: () => void
  onUnauthorized: () => void
}

const AUTOSAVE_DELAY = 500
const ACK_TIMEOUT = 8_000
const RETRY_DELAY = 2_000

const bytes = (value: unknown) =>
  value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : value instanceof Uint8Array
      ? value
      : undefined

const covers = (version: VersionVector, target: VersionVector) =>
  (version.compare(target) ?? -1) >= 0

class SyncRejected extends Error {
  readonly status: number
  readonly code: unknown

  constructor(status: number, code: unknown) {
    super('Loro draft sync was rejected.')
    this.status = status
    this.code = code
  }
}

export class LoroDraftProvider {
  private readonly options: Options
  private readonly serverDoc = new LoroDoc()
  private readonly restored: Promise<void>
  private readonly unsubscribe: () => void
  private readonly edits = new Map<string, LoroDraftEdit>()
  private readonly scope: string
  private retirements: readonly LoroDraftRetirement[]
  private storage?: LoroDraftStorage
  private writes = Promise.resolve()
  private sequence = 0
  private ready = false
  private closed = false
  private unavailable = false
  private retired = false
  private cleanupRetry = false
  private cleanupFailureReported = false
  private joined = false
  private connection = 0
  private requested = false
  private timer?: ReturnType<typeof setTimeout>
  private inFlight?: Promise<WorkflowSyncResult>
  private confirmedEmpty?: VersionVector

  constructor(options: Options) {
    this.options = options
    this.scope = JSON.stringify([options.identity.accountId, options.appId, options.identity.epoch])
    this.retirements = options.retirements ?? []
    this.restored = this.restore()
    this.restored.catch(this.markUnavailable)
    this.unsubscribe = options.doc.subscribeLocalUpdates((update) => {
      if (this.retired) return
      const id = `${options.doc.peerIdStr}:${++this.sequence}`
      const edit = {
        id,
        bytes: update,
        endVersion: decodeImportBlobMeta(update, false).partialEndVersionVector.encode(),
      }
      this.edits.set(id, edit)
      this.options.onPendingChange(true)
      this.writes = Promise.all([this.writes, this.storage!.append(edit)]).then(([, accepted]) => {
        if (!accepted && !this.closed) this.markRetired()
      })
      this.writes.catch(this.markUnavailable)
      this.schedule()
    })
  }

  private async restore() {
    const { doc } = this.options
    const storage = await LoroDraftStorage.open(this.scope)
    if (this.closed) {
      storage.close()
      return
    }
    this.storage = storage
    if (this.retirements.length) {
      const accepted = await storage.queueRetirements(this.retirements)
      if (this.closed) return
      if (!accepted) {
        this.markRetired()
        return
      }
      this.retirements = []
    }
    const { checkpoint, edits, retired } = await storage.read()
    if (!this.closed && retired) {
      this.markRetired()
      return
    }
    if (this.closed || !checkpoint) return
    this.serverDoc.import(checkpoint.snapshot)
    doc.importBatch([checkpoint.snapshot, ...edits.map((edit) => edit.bytes)])
    if (doc.exportPendingUpdates()) throw new Error('Incomplete local Loro draft history.')
    edits.forEach((edit) => this.edits.set(edit.id, edit))
    this.options.onPendingChange(this.edits.size > 0)
    this.markReady()
  }

  get retirementCandidates(): readonly LoroDraftRetirement[] {
    return [...this.retirements, { scope: this.scope, hadPendingEdits: this.edits.size > 0 }]
  }

  private markRetired() {
    this.retired = true
    this.options.onEpochChanged()
    this.schedule(RETRY_DELAY)
  }

  private markReady() {
    if (this.ready) return
    this.ready = true
    this.options.onReady()
  }

  private markUnavailable = () => {
    if (this.closed || this.unavailable) return
    this.unavailable = true
    this.options.onUnavailable()
  }

  get isUnavailable() {
    return this.unavailable
  }

  join() {
    if (this.joined) return
    this.joined = true
    this.schedule(0)
  }

  leave() {
    this.joined = false
    this.connection += 1
    clearTimeout(this.timer)
    this.timer = undefined
  }

  pull() {
    this.schedule(0)
  }

  private schedule(delay = AUTOSAVE_DELAY) {
    this.requested = true
    if (!this.joined || this.unavailable || this.closed || this.inFlight) return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.sync().catch(() => {})
    }, delay)
  }

  async flush(allowEmpty = false): Promise<WorkflowSyncResult> {
    await this.restored
    if (!this.ready) throw new Error('Loro draft has not been loaded.')
    const target = this.options.doc.version()
    if (allowEmpty && this.options.isEmpty()) this.confirmedEmpty = target
    const result = await this.sync()
    if (covers(this.serverDoc.version(), target)) return result
    const next = await this.sync()
    if (!covers(this.serverDoc.version(), target))
      throw new Error('Draft changes are still pending.')
    return next
  }

  private sync(): Promise<WorkflowSyncResult> {
    if (this.inFlight) return this.inFlight
    if (!this.joined || !this.options.socket.connected || this.unavailable || this.closed)
      return Promise.reject(new Error('Loro draft connection is not available.'))

    this.requested = false
    const connection = this.connection
    let retry = false
    const request = this.exchange(connection)
      .catch((error: unknown) => {
        if (connection !== this.connection || this.closed) throw error
        if (error instanceof SyncRejected && error.status === 401) {
          this.leave()
          this.options.onUnauthorized()
        } else if (error instanceof SyncRejected && error.code === 'epoch_changed') {
          this.options.onEpochChanged()
          retry = true
        } else if (
          error instanceof SyncRejected &&
          (error.status === 403 || error.status === 404)
        ) {
          this.markUnavailable()
        } else {
          retry = !(error instanceof SyncRejected) || error.status >= 500
        }
        throw error
      })
      .finally(() => {
        if (this.inFlight !== request) return
        this.inFlight = undefined
        if (retry || this.requested || this.cleanupRetry)
          this.schedule(retry || this.cleanupRetry ? RETRY_DELAY : 0)
      })
    this.inFlight = request
    return request
  }

  private async exchange(connection: number): Promise<WorkflowSyncResult> {
    await this.restored
    const { doc, socket, identity } = this.options
    const target = doc.version()
    const base = this.serverDoc.version()
    const allowEmpty = !!this.confirmedEmpty && covers(this.confirmedEmpty, target)
    const update =
      !this.retired && !covers(base, target) && (!this.options.isEmpty() || allowEmpty)
        ? doc.export({ mode: 'update', from: base })
        : undefined
    // Capture the delta before awaiting the writes. Edits made during the wait belong to the next batch.
    await this.writes
    if (this.closed || this.unavailable || connection !== this.connection || !socket.connected)
      throw new Error('Loro draft connection changed.')

    const { response, status } = await new Promise<{ response: unknown; status: number }>(
      (resolve, reject) => {
        socket.timeout(ACK_TIMEOUT).emit(
          'loro_draft_sync',
          {
            epoch: identity.epoch,
            version: base.encode(),
            update,
            allow_empty: allowEmpty,
          },
          (error: Error | null, response: unknown, status: number) => {
            if (error) reject(error)
            else resolve({ response, status })
          },
        )
      },
    )
    if (this.closed || connection !== this.connection)
      throw new Error('Loro draft connection changed.')

    const body = response as Partial<
      WorkflowSyncResult & { epoch: string; version: unknown; update: unknown; msg: unknown }
    > | null
    if (status !== 200) throw new SyncRejected(status, body?.msg)
    const encodedVersion = bytes(body?.version)
    if (
      body?.epoch !== identity.epoch ||
      !encodedVersion ||
      typeof body.hash !== 'string' ||
      typeof body.updatedAt !== 'number'
    )
      throw new Error('Invalid Loro draft confirmation.')

    const confirmed = VersionVector.decode(encodedVersion)
    const delta = bytes(body.update)
    if (delta) this.serverDoc.import(delta)
    if (this.serverDoc.version().compare(confirmed) !== 0 || (update && !covers(confirmed, target)))
      throw new Error('Incomplete Loro draft confirmation.')

    const coveredIds = [...this.edits.values()]
      .filter((edit) => covers(confirmed, VersionVector.decode(edit.endVersion)))
      .map((edit) => edit.id)
    let accepted: boolean
    try {
      accepted = await this.storage!.confirm(
        this.serverDoc.export({ mode: 'snapshot' }),
        confirmed,
        coveredIds,
      )
    } catch (error) {
      this.markUnavailable()
      throw error
    }
    if (!accepted) throw new SyncRejected(409, 'epoch_changed')
    if (this.closed) throw new Error('Loro draft connection closed.')
    coveredIds.forEach((id) => this.edits.delete(id))
    this.options.onPendingChange(this.edits.size > 0)
    if (delta) doc.import(delta)
    this.markReady()
    let cleanup: LoroDraftConfirmation['cleanup']
    try {
      const cleared = await this.storage!.clearRetiredDrafts()
      if (cleared.retired) throw new SyncRejected(409, 'epoch_changed')
      this.cleanupRetry = false
      if (cleared.hadPendingEdits) cleanup = 'cleared'
    } catch (error) {
      if (error instanceof SyncRejected) throw error
      this.cleanupRetry = true
      if (!this.cleanupFailureReported) {
        cleanup = 'failed'
        this.cleanupFailureReported = true
      }
    }
    if (this.closed) throw new Error('Loro draft connection closed.')
    const result = { hash: body.hash, updatedAt: body.updatedAt }
    this.options.onConfirmed({
      ...result,
      cleanup,
      isEmpty:
        this.serverDoc.getMap('nodes').size === 0 && this.serverDoc.getMap('edges').size === 0,
    })
    return result
  }

  destroy() {
    this.closed = true
    this.leave()
    this.unsubscribe()
    this.storage?.close()
  }
}
