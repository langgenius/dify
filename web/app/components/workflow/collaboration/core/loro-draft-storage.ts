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

type DraftRecord = Checkpoint | (LoroDraftEdit & { kind: 'edit'; scope: string })

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
    }
  }

  async append(edit: LoroDraftEdit) {
    const tx = this.db.transaction(STORE, 'readwrite', { durability: 'strict' })
    const done = committed(tx)
    tx.objectStore(STORE).add({ ...edit, kind: 'edit', scope: this.scope } satisfies DraftRecord)
    await done
  }

  async confirm(snapshot: Uint8Array, version: VersionVector, coveredIds: string[]) {
    const tx = this.db.transaction(STORE, 'readwrite', { durability: 'strict' })
    const done = committed(tx)
    const store = tx.objectStore(STORE)
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
  }

  close() {
    this.db.close()
  }
}
