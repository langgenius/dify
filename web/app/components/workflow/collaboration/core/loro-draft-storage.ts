import type { DBSchema, IDBPDatabase, IDBPTransaction } from 'idb'
import { openDB } from 'idb'
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
  savedAt: number
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
  | { kind: 'confirmed_delta'; scope: string; id: string; bytes: Uint8Array; version: Uint8Array }
  | (LoroDraftEdit & { kind: 'edit'; scope: string })
  | RetirementTask
  | RetiredDraft

type DraftDB = DBSchema & {
  drafts: {
    key: [string, string]
    value: DraftRecord
    indexes: { scope: string }
  }
}

type DraftTransaction = IDBPTransaction<DraftDB, [typeof STORE], 'readwrite'>

const retirementTask = (scope: string, draft: LoroDraftRetirement): RetirementTask => ({
  kind: 'retirement',
  scope,
  id: `retirement:${draft.scope}`,
  draft,
})

export class LoroDraftStorage {
  private readonly db: IDBPDatabase<DraftDB>
  private readonly scope: string

  private constructor(db: IDBPDatabase<DraftDB>, scope: string) {
    this.db = db
    this.scope = scope
  }

  static async open(scope: string) {
    const db = await openDB<DraftDB>(DB_NAME, 1, {
      upgrade(database) {
        database
          .createObjectStore(STORE, { keyPath: ['scope', 'id'] })
          .createIndex('scope', 'scope')
      },
      blocking() {
        db.close()
      },
    })
    return new LoroDraftStorage(db, scope)
  }

  private async write<T>(operation: (tx: DraftTransaction) => Promise<T>): Promise<T> {
    const tx = this.db.transaction(STORE, 'readwrite', { durability: 'strict' })
    const [value] = await Promise.all([operation(tx), tx.done])
    return value
  }

  async read() {
    const records = await this.db.getAllFromIndex(STORE, 'scope', this.scope)
    return {
      checkpoint: records.find((record) => record.kind === 'checkpoint'),
      deltas: records.filter((record) => record.kind === 'confirmed_delta'),
      edits: records.filter((record) => record.kind === 'edit'),
      retired: records.some((record) => record.kind === 'retired'),
    }
  }

  append(edit: LoroDraftEdit) {
    return this.write(async ({ store }) => {
      if (await store.get([this.scope, 'retired'])) return false
      await store.add({ ...edit, kind: 'edit', scope: this.scope })
      return true
    })
  }

  discardEdits(ids: string[]) {
    return this.write(async ({ store }) => {
      await Promise.all(ids.map((id) => store.delete([this.scope, id])))
    })
  }

  replaceCheckpoint(
    snapshot: Uint8Array,
    version: VersionVector,
    obsoleteIds: string[],
    replacementEdits: LoroDraftEdit[] = [],
  ) {
    return this.appendConfirmedDelta(
      () => snapshot,
      version,
      obsoleteIds,
      undefined,
      undefined,
      replacementEdits,
      true,
    )
  }

  appendConfirmedDelta(
    snapshot: () => Uint8Array,
    version: VersionVector,
    coveredIds: string[],
    from?: VersionVector,
    delta?: Uint8Array,
    replacementEdits: LoroDraftEdit[] = [],
    replace = false,
  ) {
    return this.write(async ({ store }) => {
      if (await store.get([this.scope, 'retired'])) return false
      const previous = await store.get([this.scope, 'checkpoint'])
      const deltas = await store.getAll(
        IDBKeyRange.bound([this.scope, 'delta:'], [this.scope, 'delta:~']),
      )
      const latest = deltas.at(-1) ?? previous
      const latestVersion =
        latest && 'version' in latest ? VersionVector.decode(latest.version) : undefined
      const order = latestVersion ? version.compare(latestVersion) : 1
      if (order === undefined) throw new Error('Incomparable draft checkpoint.')
      if (order === 1 || (!delta && order === 0 && (replace || deltas.length > 0)) || !previous) {
        const compact =
          !delta ||
          !previous ||
          previous.kind !== 'checkpoint' ||
          Date.now() - previous.savedAt >= 10000 ||
          deltas.length + 1 >= 20 ||
          !latestVersion ||
          from?.compare(latestVersion) !== 0
        if (compact) {
          await store.put({
            scope: this.scope,
            kind: 'checkpoint',
            id: 'checkpoint',
            version: version.encode(),
            snapshot: snapshot(),
            savedAt: Date.now(),
          })
          await Promise.all(deltas.map((record) => store.delete([this.scope, record.id])))
        } else if (order === 1) {
          const id = `delta:${String(deltas.length + 1).padStart(12, '0')}`
          await store.put({
            scope: this.scope,
            kind: 'confirmed_delta',
            id,
            bytes: delta,
            version: version.encode(),
          })
        }
      }
      await Promise.all(coveredIds.map((id) => store.delete([this.scope, id])))
      await Promise.all(
        replacementEdits.map((edit) => store.put({ ...edit, kind: 'edit', scope: this.scope })),
      )
      return true
    })
  }

  async previousScopes() {
    const [account, app] = JSON.parse(this.scope) as string[]
    const keys = await this.db.getAllKeysFromIndex(STORE, 'scope')
    const scopes = new Set(
      keys
        .map(([scope]) => scope)
        .filter((scope) => {
          const [otherAccount, otherApp] = JSON.parse(scope) as string[]
          return scope !== this.scope && otherAccount === account && otherApp === app
        }),
    )
    const active = await Promise.all(
      [...scopes].map(async (scope) =>
        (await this.db.get(STORE, [scope, 'retired']))
          ? undefined
          : { scope, hadPendingEdits: false },
      ),
    )
    return active.filter((draft) => draft !== undefined)
  }

  queueRetirements(drafts: readonly LoroDraftRetirement[]) {
    return this.write(async ({ store }) => {
      const scopes = [...new Set([this.scope, ...drafts.map((draft) => draft.scope)])]
      const records = await Promise.all(scopes.map((scope) => store.index('scope').getAll(scope)))
      if (records[0]!.some((record) => record.kind === 'retired')) return false
      const tasks = new Map<string, LoroDraftRetirement>()
      const remember = (draft: LoroDraftRetirement) => {
        const previous = tasks.get(draft.scope)
        tasks.set(draft.scope, {
          scope: draft.scope,
          hadPendingEdits: draft.hadPendingEdits || !!previous?.hadPendingEdits,
        })
      }
      for (const [index, entries] of records.entries()) {
        for (const record of entries) {
          if (record.kind === 'retirement') {
            remember(record.draft)
            if (index > 0) await store.delete([record.scope, record.id])
          }
        }
      }
      for (const draft of drafts) {
        const entries = records[scopes.indexOf(draft.scope)]!
        remember({
          ...draft,
          hadPendingEdits:
            draft.hadPendingEdits || entries.some((record) => record.kind === 'edit'),
        })
        await store.put({ kind: 'retired', scope: draft.scope, id: 'retired' })
      }
      await Promise.all(
        Array.from(tasks.values(), (draft) => store.put(retirementTask(this.scope, draft))),
      )
      return true
    })
  }

  clearRetiredDrafts() {
    return this.write(async ({ store }) => {
      const index = store.index('scope')
      const records = await index.getAll(this.scope)
      if (records.some((record) => record.kind === 'retired'))
        return { retired: true, hadPendingEdits: false }

      const tasks = records.filter((record) => record.kind === 'retirement')
      for (const task of tasks) {
        for await (const cursor of index.iterate(task.draft.scope)) {
          if (cursor.value.kind !== 'retired') await cursor.delete()
        }
        await store.delete([this.scope, task.id])
      }
      return { retired: false, hadPendingEdits: tasks.some((task) => task.draft.hadPendingEdits) }
    })
  }

  close() {
    this.db.close()
  }
}
