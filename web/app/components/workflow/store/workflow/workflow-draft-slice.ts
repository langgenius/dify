import type { Viewport } from 'reactflow'
import type { StateCreator } from 'zustand'
import type { Edge, EnvironmentVariable, Node } from '@/app/components/workflow/types'
import type { EnvironmentVariablePatch } from '@/service/workflow'
import { debounce } from 'es-toolkit/compat'
import { v4 as uuidV4 } from 'uuid'

type DebouncedFunc = {
  (fn: () => void): void
  cancel?: () => void
  flush?: () => void
}

type WorkflowDraftSaveInput = {
  appId: string
  generation: number
  keepalive: boolean
  environmentVariablePatch?: EnvironmentVariablePatch
}

type WorkflowDraftSaveEntry = {
  clientSaveId: string
  sequence: number
  environmentVariablePatch?: EnvironmentVariablePatch
}

type WorkflowDraftSaveSubmission = {
  clientSaveId: string
  predecessorSaves: WorkflowDraftSaveEntry[]
  environmentVariablePatch?: EnvironmentVariablePatch
}

export type WorkflowDraftSave = {
  isCurrent: () => boolean
  start: () => WorkflowDraftSaveSubmission | null
  acknowledge: () => void
  reject: () => void
}

type PendingWorkflowDraftSave = WorkflowDraftSaveInput &
  WorkflowDraftSaveEntry &
  WorkflowDraftSaveSubmission & {
    superseded: boolean
    dispatched: boolean
    acknowledged: boolean
    rejected: boolean
  }

export type WorkflowDraftSliceShape = {
  workflowDraftSyncPhase: 'idle' | 'preparing' | 'builder'
  setWorkflowDraftSyncPhase: (phase: WorkflowDraftSliceShape['workflowDraftSyncPhase']) => void
  enqueueWorkflowDraftOperation: <T>(operation: () => Promise<T>) => Promise<T>
  runWorkflowDraftSave: <T>(
    input: WorkflowDraftSaveInput,
    operation: (save: WorkflowDraftSave) => Promise<T>,
  ) => Promise<T>
  lastSavedWorkflowDraft: {
    appId: string
    generation: number
    hash: string
    clientSaveId: string | null
  } | null
  setLastSavedWorkflowDraft: (saved: WorkflowDraftSliceShape['lastSavedWorkflowDraft']) => void
  backupDraft?: {
    nodes: Node[]
    edges: Edge[]
    viewport: Viewport
    features?: Record<string, any>
    environmentVariables: EnvironmentVariable[]
  }
  setBackupDraft: (backupDraft?: WorkflowDraftSliceShape['backupDraft']) => void
  debouncedSyncWorkflowDraft: DebouncedFunc
  syncWorkflowDraftHash: string
  syncWorkflowDraftSaveId: string | null
  syncWorkflowDraftIsEmpty: boolean | undefined
  setSyncWorkflowDraftHash: (
    hash: string,
    graph?: { nodes: unknown[]; edges: unknown[] },
    clientSaveId?: string | null,
  ) => void
  adoptWorkflowDraftSaveId: (appId: string, hash: string, clientSaveId?: string | null) => void
  workflowDraftGeneration: number
  workflowDraftLocalRevision: number
  workflowDraftSavedRevision: number
  markWorkflowDraftDirty: () => number
  markWorkflowDraftSaved: (revision: number) => void
  invalidateWorkflowDraftSync: () => number
  hasWorkflowDraftConflict: boolean
  workflowDraftConflictId: number
  setWorkflowDraftConflict: (conflicted: boolean) => void
  isSyncingWorkflowDraft: boolean
  setIsSyncingWorkflowDraft: (isSyncingWorkflowDraft: boolean) => void
  isWorkflowDataLoaded: boolean
  setIsWorkflowDataLoaded: (loaded: boolean) => void
  nodes: Node[]
  setNodes: (nodes: Node[]) => void
  flushPendingSync: () => void
}

export const createWorkflowDraftSlice: StateCreator<WorkflowDraftSliceShape> = (set, get) => {
  // Unload saves start immediately; every queued operation still waits for them.
  let draftQueue: Promise<unknown> = Promise.resolve()
  const immediateSaves = new Set<Promise<unknown>>()
  const pendingSaves = new Map<string, PendingWorkflowDraftSave>()
  const unacknowledgedSaves = new Map<string, PendingWorkflowDraftSave>()
  let nextSaveSequence = 0
  // Create the debounced function and store it with access to cancel/flush methods
  const debouncedFn = debounce((syncWorkflowDraft) => {
    syncWorkflowDraft()
  }, 5000)

  return {
    workflowDraftSyncPhase: 'idle',
    setWorkflowDraftSyncPhase: (workflowDraftSyncPhase) => set({ workflowDraftSyncPhase }),
    enqueueWorkflowDraftOperation: (operation) => {
      const next = draftQueue
        .catch(() => undefined)
        .then(async () => {
          while (immediateSaves.size > 0) await Promise.allSettled([...immediateSaves])
          return operation()
        })
      draftQueue = next
      return next
    },
    runWorkflowDraftSave: (input, operation) => {
      const pending: PendingWorkflowDraftSave = {
        ...input,
        clientSaveId: uuidV4(),
        sequence: nextSaveSequence++,
        predecessorSaves: [],
        superseded: false,
        dispatched: false,
        acknowledged: false,
        rejected: false,
      }
      pendingSaves.set(pending.clientSaveId, pending)
      const save: WorkflowDraftSave = {
        isCurrent: () => !pending.superseded,
        start: () => {
          if (pending.superseded) return null
          const previous = [
            ...unacknowledgedSaves.values(),
            ...(pending.keepalive ? pendingSaves.values() : []),
          ].filter(
            (candidate) =>
              candidate.sequence < pending.sequence &&
              candidate.appId === pending.appId &&
              candidate.generation === pending.generation,
          )
          if (previous.length > 0) {
            const predecessors = new Map<string, WorkflowDraftSaveEntry>()
            for (const candidate of previous) {
              for (const entry of [...candidate.predecessorSaves, candidate]) {
                predecessors.set(entry.clientSaveId, {
                  clientSaveId: entry.clientSaveId,
                  sequence: entry.sequence,
                  environmentVariablePatch: entry.environmentVariablePatch,
                })
              }
            }
            pending.predecessorSaves = [...predecessors.values()].sort(
              (a, b) => a.sequence - b.sequence,
            )
            for (const candidate of previous) candidate.superseded = true
          }
          pending.dispatched = true
          return {
            clientSaveId: pending.clientSaveId,
            predecessorSaves: pending.predecessorSaves,
            environmentVariablePatch: pending.environmentVariablePatch,
          }
        },
        acknowledge: () => {
          pending.acknowledged = true
          for (const candidate of unacknowledgedSaves.values()) {
            if (
              candidate.sequence < pending.sequence &&
              candidate.appId === pending.appId &&
              candidate.generation === pending.generation
            )
              unacknowledgedSaves.delete(candidate.clientSaveId)
          }
        },
        reject: () => {
          pending.rejected = true
          pending.environmentVariablePatch = undefined
        },
      }
      const run = () =>
        operation(save).finally(() => {
          pendingSaves.delete(pending.clientSaveId)
          if (
            pending.dispatched &&
            !pending.acknowledged &&
            !pending.superseded &&
            (!pending.rejected || pending.predecessorSaves.length > 0) &&
            pending.generation === get().workflowDraftGeneration
          )
            unacknowledgedSaves.set(pending.clientSaveId, pending)
        })
      if (!input.keepalive) return get().enqueueWorkflowDraftOperation(run)

      const result = run()
      immediateSaves.add(result)
      return result.finally(() => immediateSaves.delete(result))
    },
    lastSavedWorkflowDraft: null,
    setLastSavedWorkflowDraft: (lastSavedWorkflowDraft) => set({ lastSavedWorkflowDraft }),
    backupDraft: undefined,
    setBackupDraft: (backupDraft) => set(() => ({ backupDraft })),
    debouncedSyncWorkflowDraft: debouncedFn,
    syncWorkflowDraftHash: '',
    syncWorkflowDraftSaveId: null,
    syncWorkflowDraftIsEmpty: undefined,
    setSyncWorkflowDraftHash: (syncWorkflowDraftHash, graph, clientSaveId) =>
      set(() => ({
        syncWorkflowDraftHash,
        syncWorkflowDraftSaveId: clientSaveId ?? null,
        syncWorkflowDraftIsEmpty: graph
          ? graph.nodes.length === 0 && graph.edges.length === 0
          : undefined,
      })),
    // An unrelated receipt must not authorize replaying unresolved local variable patches.
    adoptWorkflowDraftSaveId: (appId, hash, clientSaveId) => {
      const state = get()
      if (hash !== state.syncWorkflowDraftHash) return
      const hasUnresolvedSave = [...pendingSaves.values(), ...unacknowledgedSaves.values()].some(
        (candidate) =>
          candidate.appId === appId && candidate.generation === state.workflowDraftGeneration,
      )
      if (!hasUnresolvedSave) set({ syncWorkflowDraftSaveId: clientSaveId ?? null })
    },
    workflowDraftGeneration: 0,
    workflowDraftLocalRevision: 0,
    workflowDraftSavedRevision: 0,
    markWorkflowDraftDirty: () => {
      const workflowDraftLocalRevision = get().workflowDraftLocalRevision + 1
      set({ workflowDraftLocalRevision })
      return workflowDraftLocalRevision
    },
    markWorkflowDraftSaved: (revision) =>
      set((state) => ({
        workflowDraftSavedRevision: Math.max(state.workflowDraftSavedRevision, revision),
      })),
    hasWorkflowDraftConflict: false,
    workflowDraftConflictId: 0,
    setWorkflowDraftConflict: (hasWorkflowDraftConflict) => {
      const newConflict = hasWorkflowDraftConflict && !get().hasWorkflowDraftConflict
      if (hasWorkflowDraftConflict) get().invalidateWorkflowDraftSync()
      set({
        hasWorkflowDraftConflict,
        workflowDraftConflictId: get().workflowDraftConflictId + (newConflict ? 1 : 0),
      })
    },
    invalidateWorkflowDraftSync: () => {
      debouncedFn.cancel()
      unacknowledgedSaves.clear()
      const workflowDraftGeneration = get().workflowDraftGeneration + 1
      set({
        workflowDraftGeneration,
        workflowDraftSavedRevision: get().workflowDraftLocalRevision,
        isSyncingWorkflowDraft: false,
      })
      return workflowDraftGeneration
    },
    isSyncingWorkflowDraft: false,
    setIsSyncingWorkflowDraft: (isSyncingWorkflowDraft) => set(() => ({ isSyncingWorkflowDraft })),
    isWorkflowDataLoaded: false,
    setIsWorkflowDataLoaded: (loaded) => set(() => ({ isWorkflowDataLoaded: loaded })),
    nodes: [],
    setNodes: (nodes) => set(() => ({ nodes })),
    flushPendingSync: () => {
      // Flush any pending debounced sync operations
      if (debouncedFn.flush) debouncedFn.flush()
    },
  }
}
