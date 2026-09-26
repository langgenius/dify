import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import { create } from 'zustand'

type State = {
  appDetail?: AppDetailWithSite
  currentLogItem?: IChatItem
  currentLogModalActiveTab: string
  showPromptLogModal: boolean
  showAgentLogModal: boolean
  showMessageLogModal: boolean
  showAppConfigureFeaturesModal: boolean
}

type Action = {
  setAppDetail: (appDetail?: AppDetailWithSite) => void
  setCurrentLogItem: (item?: IChatItem) => void
  setCurrentLogModalActiveTab: (tab: string) => void
  setShowPromptLogModal: (showPromptLogModal: boolean) => void
  setShowAgentLogModal: (showAgentLogModal: boolean) => void
  setShowMessageLogModal: (showMessageLogModal: boolean) => void
  setShowAppConfigureFeaturesModal: (showAppConfigureFeaturesModal: boolean) => void
}

export const useStore = create<State & Action>((set) => ({
  appDetail: undefined,
  setAppDetail: (appDetail) => set(() => ({ appDetail })),
  currentLogItem: undefined,
  currentLogModalActiveTab: 'DETAIL',
  setCurrentLogItem: (currentLogItem) => set(() => ({ currentLogItem })),
  setCurrentLogModalActiveTab: (currentLogModalActiveTab) =>
    set(() => ({ currentLogModalActiveTab })),
  showPromptLogModal: false,
  setShowPromptLogModal: (showPromptLogModal) => set(() => ({ showPromptLogModal })),
  showAgentLogModal: false,
  setShowAgentLogModal: (showAgentLogModal) => set(() => ({ showAgentLogModal })),
  showMessageLogModal: false,
  setShowMessageLogModal: (showMessageLogModal) =>
    set(() => {
      if (showMessageLogModal) {
        return { showMessageLogModal }
      } else {
        return {
          showMessageLogModal,
          currentLogModalActiveTab: 'DETAIL',
        }
      }
    }),
  showAppConfigureFeaturesModal: false,
  setShowAppConfigureFeaturesModal: (showAppConfigureFeaturesModal) =>
    set(() => ({ showAppConfigureFeaturesModal })),
}))
