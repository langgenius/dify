import type { Viewport } from 'reactflow'
import type { StateCreator } from 'zustand'
import type { Edge, EnvironmentVariable, Node } from '@/app/components/workflow/types'
import type { RAGPipelineVariables } from '@/models/pipeline'
import { debounce } from 'es-toolkit/compat'
import { isAgentV2NodeData } from '../../nodes/agent-v2/types'

type DebouncedFunc = {
  (fn: () => void): void
  cancel?: () => void
  flush?: () => void
}

export type AgentSessionContinuitySave = {
  phase: 'saving' | 'failed'
  requested: boolean
  confirmed: boolean
}

export type WorkflowDraftSliceShape = {
  backupDraft?: {
    nodes: Node[]
    edges: Edge[]
    viewport: Viewport
    features?: Record<string, any>
    environmentVariables: EnvironmentVariable[]
    // Knowledge pipeline input fields; previewing a version replaces them too.
    ragPipelineVariables?: RAGPipelineVariables
  }
  setBackupDraft: (backupDraft?: WorkflowDraftSliceShape['backupDraft']) => void
  debouncedSyncWorkflowDraft: DebouncedFunc
  syncWorkflowDraftHash: string
  syncWorkflowDraftIsEmpty: boolean | undefined
  setSyncWorkflowDraftHash: (hash: string, graph?: { nodes: unknown[]; edges: unknown[] }) => void
  isSyncingWorkflowDraft: boolean
  setIsSyncingWorkflowDraft: (isSyncingWorkflowDraft: boolean) => void
  isWorkflowDataLoaded: boolean
  setIsWorkflowDataLoaded: (loaded: boolean) => void
  agentSessionContinuitySaves: ReadonlyMap<string, AgentSessionContinuitySave>
  setAgentSessionContinuitySave: (nodeId: string, save?: AgentSessionContinuitySave) => void
  confirmAgentSessionContinuitySaves: (nodes: Node[]) => void
  nodes: Node[]
  setNodes: (nodes: Node[]) => void
  flushPendingSync: () => void
}

export const createWorkflowDraftSlice: StateCreator<WorkflowDraftSliceShape> = (set) => {
  // Create the debounced function and store it with access to cancel/flush methods
  const debouncedFn = debounce((syncWorkflowDraft) => {
    syncWorkflowDraft()
  }, 5000)

  return {
    backupDraft: undefined,
    setBackupDraft: (backupDraft) => set(() => ({ backupDraft })),
    debouncedSyncWorkflowDraft: debouncedFn,
    syncWorkflowDraftHash: '',
    syncWorkflowDraftIsEmpty: undefined,
    setSyncWorkflowDraftHash: (syncWorkflowDraftHash, graph) =>
      set(() => ({
        syncWorkflowDraftHash,
        syncWorkflowDraftIsEmpty: graph
          ? graph.nodes.length === 0 && graph.edges.length === 0
          : undefined,
      })),
    isSyncingWorkflowDraft: false,
    setIsSyncingWorkflowDraft: (isSyncingWorkflowDraft) => set(() => ({ isSyncingWorkflowDraft })),
    isWorkflowDataLoaded: false,
    setIsWorkflowDataLoaded: (loaded) => set(() => ({ isWorkflowDataLoaded: loaded })),
    agentSessionContinuitySaves: new Map(),
    setAgentSessionContinuitySave: (nodeId, save) =>
      set((state) => {
        const agentSessionContinuitySaves = new Map(state.agentSessionContinuitySaves)
        if (save) agentSessionContinuitySaves.set(nodeId, save)
        else agentSessionContinuitySaves.delete(nodeId)
        return { agentSessionContinuitySaves }
      }),
    confirmAgentSessionContinuitySaves: (nodes) =>
      set((state) => {
        if (!state.agentSessionContinuitySaves.size) return state

        const agentSessionContinuitySaves = new Map(state.agentSessionContinuitySaves)
        for (const { id, data } of nodes) {
          const save = agentSessionContinuitySaves.get(id)
          if (save && isAgentV2NodeData(data) && data.continue_agent_session === save.requested)
            agentSessionContinuitySaves.delete(id)
        }
        return agentSessionContinuitySaves.size === state.agentSessionContinuitySaves.size
          ? state
          : { agentSessionContinuitySaves }
      }),
    nodes: [],
    setNodes: (nodes) => set(() => ({ nodes })),
    flushPendingSync: () => {
      // Flush any pending debounced sync operations
      if (debouncedFn.flush) debouncedFn.flush()
    },
  }
}
