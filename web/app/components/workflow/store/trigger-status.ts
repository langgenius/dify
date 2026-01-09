import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

export type EntryNodeStatus = 'enabled' | 'disabled'

type TriggerStatusState = {
  // Map of nodeId to trigger status
  triggerStatuses: Record<string, EntryNodeStatus>

  // Actions
  setTriggerStatus: (nodeId: string, status: EntryNodeStatus) => void
  setTriggerStatuses: (statuses: Record<string, EntryNodeStatus>) => void
  getTriggerStatus: (nodeId: string) => EntryNodeStatus
  clearTriggerStatuses: () => void
}

export const useTriggerStatusStore = create<TriggerStatusState>()(
  subscribeWithSelector((set, get) => ({
    triggerStatuses: {},

    setTriggerStatus: (nodeId: string, status: EntryNodeStatus) => {
      set(state => ({
        triggerStatuses: {
          ...state.triggerStatuses,
          [nodeId]: status,
        },
      }))
    },

    setTriggerStatuses: (statuses: Record<string, EntryNodeStatus>) => {
      set({ triggerStatuses: statuses })
    },

    getTriggerStatus: (nodeId: string): EntryNodeStatus => {
      return get().triggerStatuses[nodeId] || 'disabled'
    },

    clearTriggerStatuses: () => {
      set({ triggerStatuses: {} })
    },
  })),
)
