import type { Socket } from 'socket.io-client'
import type { WorkflowSyncResult } from '../types/collaboration'
import type { LoroDraftEdit, LoroDraftRetirement } from './loro-draft-storage'
import { isEqual } from 'es-toolkit/predicate'
import { decodeImportBlobMeta, LoroDoc, VersionVector } from 'loro-crdt'
import { changeDraftEntities, projectDraftGraph, replayDraftViewport } from './loro-draft-document'
import { LoroDraftStorage } from './loro-draft-storage'

export type LoroDraftIdentity = Readonly<{ epoch: string; accountId: string }>
export type LoroDraftConfirmation = WorkflowSyncResult & {
  isEmpty: boolean
  cleanup?: 'cleared' | 'failed' | 'skipped'
}

type Options = {
  appId: string
  identity: LoroDraftIdentity
  retirements?: readonly LoroDraftRetirement[]
  doc: LoroDoc
  socket: Socket
  onDocument?: (doc: LoroDoc) => void
  onReady: (isEmpty: boolean) => void
  onConfirmed: (result: LoroDraftConfirmation) => void
  onPendingChange: (pending: boolean) => void
  onEpochChanged: () => void
  onEmptyConfirmationRequired?: () => void
  onUnavailable: () => void
  onUnauthorized: () => void
}

type DraftNotification = Partial<WorkflowSyncResult> & {
  epoch: string
  fromVersion?: unknown
  version?: unknown
  update?: unknown
}
const AUTOSAVE_DELAY = 500
const ACK_TIMEOUT = 8_000
const RETRY_DELAY = 2_000
const pullDelay = () => 50 + Math.floor(Math.random() * 151)

const bytes = (value: unknown) =>
  value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : value instanceof Uint8Array
      ? value
      : undefined

const covers = (version: VersionVector, target: VersionVector) =>
  (version.compare(target) ?? -1) >= 0

function matchesVersion(version: VersionVector, encoded: Uint8Array) {
  try {
    return version.compare(VersionVector.decode(encoded)) === 0
  } catch {
    return false
  }
}

function isDraftEmpty(doc: LoroDoc) {
  const { nodes, edges } = projectDraftGraph(doc)
  return nodes.length === 0 && edges.length === 0
}

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
  private serverDoc = new LoroDoc()
  private readonly restored: Promise<void>
  private unsubscribe: () => void
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
  private skippedLocalEdits = false
  private previousDrafts?: LoroDraftRetirement[]
  private joined = false
  private connection = 0
  private requested = false
  private timer?: ReturnType<typeof setTimeout>
  private inFlight?: Promise<WorkflowSyncResult>
  private emptyConfirmation?: 'requested' | 'granted'

  constructor(options: Options) {
    this.options = options
    this.scope = JSON.stringify([options.identity.accountId, options.appId, options.identity.epoch])
    this.retirements = options.retirements ?? []
    this.restored = this.restore()
    this.restored.catch(this.markUnavailable)
    this.unsubscribe = this.watch(options.doc)
  }

  private edit(doc: LoroDoc, bytes: Uint8Array): LoroDraftEdit {
    return {
      id: `${doc.peerIdStr}:${++this.sequence}`,
      bytes,
      endVersion: decodeImportBlobMeta(bytes, false).partialEndVersionVector.encode(),
    }
  }

  private watch(doc: LoroDoc) {
    return doc.subscribeLocalUpdates((bytes) => {
      if (this.retired || this.unavailable) return
      if (this.emptyConfirmation && !isDraftEmpty(doc)) this.emptyConfirmation = undefined
      const edit = this.edit(doc, bytes)
      this.edits.set(edit.id, edit)
      this.options.onPendingChange(true)
      const persisted = this.storage!.append(edit)
      this.writes = Promise.all([this.writes, persisted]).then(([, accepted]) => {
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
    if (!this.options.retirements) this.previousDrafts = await storage.previousScopes()
    if (this.closed) return
    if (this.retirements.length) {
      const accepted = await storage.queueRetirements(this.retirements)
      if (this.closed) return
      if (!accepted) {
        this.markRetired()
        return
      }
      this.retirements = []
    }
    const { checkpoint, deltas, edits, retired } = await storage.read()
    if (this.closed) return
    if (retired) {
      this.markRetired()
      return
    }
    if (!checkpoint) return
    const committed = deltas.map((delta) => delta.bytes)
    this.serverDoc.import(checkpoint.snapshot)
    if (this.serverDoc.importBatch(committed).pending)
      throw new Error('Incomplete confirmed Loro history.')
    const serverVersion = this.serverDoc.version()
    const pending = edits.filter(
      (edit) => !covers(serverVersion, VersionVector.decode(edit.endVersion)),
    )
    let replayable = pending
    if (this.serverDoc.isShallow() && pending.length) {
      const replay = this.serverDoc.fork()
      for (const edit of pending) {
        try {
          replay.import(edit.bytes)
        } catch {
          continue
        }
      }
      const applied = replay.version()
      replayable = pending.filter((edit) => covers(applied, VersionVector.decode(edit.endVersion)))
      this.skippedLocalEdits = replayable.length !== pending.length
    }
    if (replayable.length !== edits.length) {
      const retained = new Set(replayable.map((edit) => edit.id))
      await storage.discardEdits(
        edits.filter((edit) => !retained.has(edit.id)).map((edit) => edit.id),
      )
      if (this.closed) return
    }
    doc.import(checkpoint.snapshot)
    const restored = doc.importBatch([...committed, ...replayable.map((edit) => edit.bytes)])
    if (restored.pending) throw new Error('Incomplete local Loro draft history.')
    replayable.forEach((edit) => this.edits.set(edit.id, edit))
    this.options.onPendingChange(this.edits.size > 0)
    this.markReady()
  }

  get retirementCandidates(): readonly LoroDraftRetirement[] {
    return [
      ...this.retirements,
      ...(this.previousDrafts ?? []),
      { scope: this.scope, hadPendingEdits: this.edits.size > 0 },
    ]
  }

  private markRetired() {
    if (this.closed) return
    this.retired = true
    this.options.onEpochChanged()
    this.schedule(RETRY_DELAY)
  }

  private checkStorageWrite(accepted: boolean) {
    if (this.closed) throw new Error('Draft connection closed.')
    if (!accepted) {
      this.markRetired()
      throw new Error('Draft epoch changed.')
    }
  }

  private requestEmptyConfirmation() {
    if (this.emptyConfirmation) return
    this.emptyConfirmation = 'requested'
    this.options.onEmptyConfirmationRequired?.()
  }

  private markReady() {
    if (this.ready) return
    this.ready = true
    this.options.onReady(isDraftEmpty(this.serverDoc))
  }

  private markUnavailable = () => {
    if (this.closed || this.unavailable) return
    this.unavailable = true
    this.options.onUnavailable()
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

  pull(notification?: DraftNotification) {
    if (notification && notification.epoch !== this.options.identity.epoch) {
      this.markRetired()
      return
    }
    const base = bytes(notification?.fromVersion)
    if (
      notification &&
      this.ready &&
      this.joined &&
      !this.closed &&
      !this.unavailable &&
      !this.retired &&
      !this.inFlight &&
      !this.edits.size &&
      base &&
      bytes(notification.update) &&
      matchesVersion(this.serverDoc.version(), base)
    ) {
      this.inFlight = this.confirm(notification)
        .catch((error: unknown) => {
          this.requested = true
          throw error
        })
        .finally(() => {
          this.inFlight = undefined
          if (this.requested || this.cleanupRetry)
            this.schedule(this.cleanupRetry ? RETRY_DELAY : pullDelay())
        })
      void this.inFlight.catch(() => {})
      return
    }
    this.schedule(pullDelay())
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
    const original = this.options.doc
    const target = original.version()
    if (allowEmpty && isDraftEmpty(original)) this.emptyConfirmation = 'granted'
    const result = await this.sync()
    if (this.options.doc !== original) return this.flush(allowEmpty)
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
      .catch(async (error: unknown) => {
        if (this.closed || connection !== this.connection || !(error instanceof SyncRejected))
          throw error
        if (error.code === 'history_compacted') return this.recoverFromCompaction(connection)
        if (error.code === 'empty_graph_confirmation_required') {
          const body = await this.request(connection, this.serverDoc.version().encode())
          const result = await this.confirm(body)
          if (isDraftEmpty(this.options.doc) && !isDraftEmpty(this.serverDoc))
            this.requestEmptyConfirmation()
          else this.requested = true
          return result
        }
        throw error
      })
      .catch((error: unknown) => {
        if (connection !== this.connection || this.closed) throw error
        if (error instanceof SyncRejected && error.status === 401) {
          this.leave()
          this.options.onUnauthorized()
        } else if (error instanceof SyncRejected && error.code === 'epoch_changed') {
          this.markRetired()
          retry = true
        } else if (
          error instanceof SyncRejected &&
          (error.status === 400 || error.status === 403 || error.status === 404)
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
    const { doc, socket } = this.options
    const target = doc.version()
    const base = this.serverDoc.version()
    const changed = !this.retired && !covers(base, target)
    const allowEmpty = this.emptyConfirmation === 'granted'
    const needsConfirmation =
      changed && !allowEmpty && isDraftEmpty(doc) && !isDraftEmpty(this.serverDoc)
    if (needsConfirmation) this.requestEmptyConfirmation()
    const update =
      changed && !needsConfirmation ? doc.export({ mode: 'update', from: base }) : undefined
    // Capture the delta before awaiting the writes. Edits made during the wait belong to the next batch.
    await this.writes
    if (this.closed || this.unavailable || connection !== this.connection || !socket.connected)
      throw new Error('Loro draft connection changed.')

    const body = await this.request(
      connection,
      this.ready ? base.encode() : null,
      update,
      allowEmpty,
    )
    return this.confirm(body, update ? target : undefined)
  }

  private async request(
    connection: number,
    version: Uint8Array | null,
    update?: Uint8Array,
    allowEmpty = false,
  ) {
    const { socket, identity } = this.options
    const { response, status } = await new Promise<{ response: unknown; status: number }>(
      (resolve, reject) => {
        socket.timeout(ACK_TIMEOUT).emit(
          'loro_draft_sync',
          {
            epoch: identity.epoch,
            version,
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
    if (this.closed || this.unavailable || connection !== this.connection)
      throw new Error('Loro draft connection changed.')

    const body = response as Partial<
      WorkflowSyncResult & {
        epoch: string
        version: unknown
        update: unknown
        msg: unknown
      }
    > | null
    if (status !== 200) throw new SyncRejected(status, body?.msg)
    if (!body) throw new Error('Missing Loro draft confirmation.')
    return body
  }

  private async recoverFromCompaction(connection: number): Promise<WorkflowSyncResult> {
    const body = await this.request(connection, null)
    const snapshot = bytes(body.update),
      encoded = bytes(body.version)
    if (
      body.epoch !== this.options.identity.epoch ||
      !snapshot ||
      !encoded ||
      typeof body.hash !== 'string' ||
      typeof body.updatedAt !== 'number'
    )
      throw new Error('Missing compacted checkpoint.')
    const server = new LoroDoc()
    server.import(snapshot)
    if (server.version().compare(VersionVector.decode(encoded)) !== 0)
      throw new Error('Invalid compacted checkpoint.')
    const local = server.fork()
    const before = projectDraftGraph(this.serverDoc),
      after = projectDraftGraph(this.options.doc)
    const next = projectDraftGraph(server)
    const removed = before.nodes.filter(
      (n) =>
        !next.nodes.some((item) => item.id === n.id) &&
        after.nodes.some((item) => item.id === n.id && !isEqual(item, n)),
    )
    const obsolete = [...this.edits.keys()]
    if (obsolete.length) {
      changeDraftEntities(local, 'nodes', before.nodes, after.nodes)
      changeDraftEntities(local, 'edges', before.edges, after.edges)
      replayDraftViewport(local, this.serverDoc, this.options.doc)
    }
    const rebased =
      local.version().compare(server.version()) === 0
        ? []
        : [this.edit(local, local.export({ mode: 'update', from: server.version() }))]
    this.unsubscribe()
    this.serverDoc = server
    this.options.doc = local
    if (this.emptyConfirmation && (!isDraftEmpty(local) || isDraftEmpty(server)))
      this.emptyConfirmation = undefined
    this.edits.clear()
    for (const edit of rebased) this.edits.set(edit.id, edit)
    this.unsubscribe = this.watch(local)
    this.options.onDocument?.(local)
    let accepted: boolean
    try {
      accepted = await this.storage!.replaceCheckpoint(
        snapshot,
        server.version(),
        obsolete,
        rebased,
      )
    } catch (error) {
      this.markUnavailable()
      throw error
    }
    this.checkStorageWrite(accepted)
    this.options.onPendingChange(!!this.edits.size)
    const result = { hash: body.hash, updatedAt: body.updatedAt, isEmpty: isDraftEmpty(server) }
    this.options.onConfirmed({ ...result, cleanup: removed.length ? 'skipped' : undefined })
    this.requested = !!this.edits.size
    return result
  }

  private async confirm(body: Partial<DraftNotification>, sent?: VersionVector) {
    const { doc, identity } = this.options
    const from = this.serverDoc.version()
    const encodedVersion = bytes(body.version)
    if (
      body.epoch !== identity.epoch ||
      !encodedVersion ||
      typeof body.hash !== 'string' ||
      typeof body.updatedAt !== 'number'
    )
      throw new Error('Invalid Loro draft confirmation.')

    const confirmed = VersionVector.decode(encodedVersion)
    const delta = bytes(body.update)
    if (sent && !covers(confirmed, sent)) throw new Error('Incomplete Loro draft confirmation.')
    let server = this.serverDoc
    if (delta) {
      server = decodeImportBlobMeta(delta, false).mode === 'update' ? server.fork() : new LoroDoc()
      if (server.import(delta).pending) throw new Error('Incomplete Loro draft confirmation.')
    }
    if (server.version().compare(confirmed) !== 0)
      throw new Error('Incomplete Loro draft confirmation.')

    const coveredIds = [...this.edits.values()]
      .filter((edit) => covers(confirmed, VersionVector.decode(edit.endVersion)))
      .map((edit) => edit.id)
    let accepted: boolean
    try {
      accepted = await this.storage!.appendConfirmedDelta(
        () => server.export({ mode: 'snapshot' }),
        confirmed,
        coveredIds,
        from,
        delta,
      )
    } catch (error) {
      this.markUnavailable()
      throw error
    }
    this.checkStorageWrite(accepted)
    let cleanup: LoroDraftConfirmation['cleanup']
    let active = true
    try {
      if (this.previousDrafts?.length) {
        active = await this.storage!.queueRetirements(this.previousDrafts)
        this.previousDrafts = undefined
      }
      if (active && !this.closed) {
        const cleared = await this.storage!.clearRetiredDrafts()
        active = !cleared.retired
        this.cleanupRetry = false
        if (cleared.hadPendingEdits) cleanup = 'cleared'
      }
    } catch (error) {
      if (this.closed) throw error
      this.cleanupRetry = true
      if (!this.cleanupFailureReported) {
        cleanup = 'failed'
        this.cleanupFailureReported = true
      }
    }
    this.checkStorageWrite(active)
    this.serverDoc = server
    coveredIds.forEach((id) => this.edits.delete(id))
    this.options.onPendingChange(this.edits.size > 0)
    if (delta) doc.import(delta)
    const isEmpty = isDraftEmpty(server)
    if (this.emptyConfirmation && (isEmpty || !isDraftEmpty(doc)))
      this.emptyConfirmation = undefined
    this.markReady()
    if (!cleanup && this.skippedLocalEdits) {
      cleanup = 'skipped'
      this.skippedLocalEdits = false
    }
    const result = { hash: body.hash, updatedAt: body.updatedAt }
    this.options.onConfirmed({
      ...result,
      cleanup,
      isEmpty,
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
