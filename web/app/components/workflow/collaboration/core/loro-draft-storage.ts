import { VersionVector } from 'loro-crdt'

const DB_NAME = 'dify-workflow-loro'
const STORE = 'drafts'

export type LoroDraftEdit = {
  id: string
  bytes: Uint8Array
  endVersion: Uint8Array
}

type Checkpoint = {
  kind: 'checkpoint'
  scope: string
  id: 'checkpoint'
  snapshot: Uint8Array
  version: Uint8Array
}

export type LoroDraftRetirement = { scope: string; hadPendingEdits: boolean }

type RetirementTask = {
  kind: 'retirement'
  scope: string
  id: string
  draft: LoroDraftRetirement
}

type RetiredDraft = { kind: 'retired'; scope: string; id: 'retired' }
type DraftRecord =
  | Checkpoint
  | (LoroDraftEdit & { kind: 'edit'; scope: string })
  | RetirementTask
  | RetiredDraft

const retirementTask = (scope: string, draft: LoroDraftRetirement): RetirementTask => ({
  kind: 'retirement',
  scope,
  id: `retirement:${draft.scope}`,
  draft,
})

const result = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const committed = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('Loro draft storage transaction aborted.'))
  })

export class LoroDraftStorage {
  private readonly db: IDBDatabase
  private readonly scope: string

  private constructor(db: IDBDatabase, scope: string) {
    this.db = db
    this.scope = scope
  }

  static async open(scope: string) {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result
        .createObjectStore(STORE, { keyPath: ['scope', 'id'] })
        .createIndex('scope', 'scope')
    }
    const db = await result(request)
    db.onversionchange = () => db.close()
    return new LoroDraftStorage(db, scope)
  }

  async read() {
    const records: DraftRecord[] = await result(
      this.db.transaction(STORE).objectStore(STORE).index('scope').getAll(this.scope),
    )
    return {
      checkpoint: records.find((record) => record.kind === 'checkpoint'),
      edits: records.filter((record) => record.kind === 'edit'),
      retired: records.some((record) => record.kind === 'retired'),
    }
  }

  async append(edit: LoroDraftEdit) {
    const tx = this.db.transaction(STORE, 'readwrite', { durability: 'strict' })
    const done = committed(tx)
    const store = tx.objectStore(STORE)
    const retired = await result(store.get([this.scope, 'retired']))
    if (!retired) store.add({ ...edit, kind: 'edit', scope: this.scope } satisfies DraftRecord)
    await done
    return !retired
  }

  async confirm(snapshot: Uint8Array, version: VersionVector, coveredIds: string[]) {
    const tx = this.db.transaction(STORE, 'readwrite', { durability: 'strict' })
    const done = committed(tx)
    const store = tx.objectStore(STORE)
    const retired = await result(store.get([this.scope, 'retired']))
    if (retired) {
      await done
      return false
    }
    const key = [this.scope, 'checkpoint']
    const request = store.get(key) as IDBRequest<Checkpoint | undefined>
    request.onsuccess = () => {
      const previous = request.result
      const order = previous ? version.compare(VersionVector.decode(previous.version)) : 1
      // Another tab may have stored a newer committed checkpoint for the same epoch.
      if (order === undefined) {
        tx.abort()
        return
      }
      if (order > 0)
        store.put({
          kind: 'checkpoint',
          id: 'checkpoint',
          scope: this.scope,
          snapshot,
          version: version.encode(),
        } satisfies Checkpoint)
      coveredIds.forEach((id) => store.delete([this.scope, id]))
    }
    await done
    return true
  }

  async queueRetirements(drafts: readonly LoroDraftRetirement[]) {
    const tx = this.db.transaction(STORE, 'readwrite', { durability: 'strict' })
    const done = committed(tx)
    const store = tx.objectStore(STORE)
    const scopes = [...new Set([this.scope, ...drafts.map((draft) => draft.scope)])]
    const records = await Promise.all(
      scopes.map((scope) => result<DraftRecord[]>(store.index('scope').getAll(scope))),
    )
    if (records[0]!.some((record) => record.kind === 'retired')) {
      await done
      return false
    }
    const tasks = new Map<string, LoroDraftRetirement>()
    const remember = (draft: LoroDraftRetirement) => {
      const previous = tasks.get(draft.scope)
      tasks.set(draft.scope, {
        scope: draft.scope,
        hadPendingEdits: draft.hadPendingEdits || !!previous?.hadPendingEdits,
      })
    }
    records.forEach((entries, index) => {
      entries.forEach((record) => {
        if (record.kind === 'retirement') {
          remember(record.draft)
          if (index > 0) store.delete([record.scope, record.id])
        }
      })
    })
    drafts.forEach((draft) => {
      const entries = records[scopes.indexOf(draft.scope)]!
      remember({
        ...draft,
        hadPendingEdits: draft.hadPendingEdits || entries.some((record) => record.kind === 'edit'),
      })
      store.put({ kind: 'retired', scope: draft.scope, id: 'retired' } satisfies RetiredDraft)
    })
    tasks.forEach((draft) => store.put(retirementTask(this.scope, draft)))
    await done
    return true
  }

  async clearRetiredDrafts() {
    const tx = this.db.transaction(STORE, 'readwrite', { durability: 'strict' })
    const done = committed(tx)
    const store = tx.objectStore(STORE)
    const records = await result<DraftRecord[]>(store.index('scope').getAll(this.scope))
    if (records.some((record) => record.kind === 'retired')) {
      await done
      return { retired: true, hadPendingEdits: false }
    }
    const tasks = records.filter((record) => record.kind === 'retirement')
    tasks.forEach((task) => {
      const request = store.index('scope').openCursor(task.draft.scope)
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return
        const record = cursor.value as DraftRecord
        if (record.kind !== 'retired') cursor.delete()
        cursor.continue()
      }
      store.delete([this.scope, task.id])
    })
    await done
    return { retired: false, hadPendingEdits: tasks.some((task) => task.draft.hadPendingEdits) }
  }

  close() {
    this.db.close()
  }
}
