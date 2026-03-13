import type { IChatItem } from '@/app/components/base/chat/chat/type'
import type { App, AppSSO } from '@/types/app'
import { create } from 'zustand'

type State = {
  appDetail?: App & Partial<AppSSO>
  appSidebarExpand: string
  currentLogItem?: IChatItem
  currentLogModalActiveTab: string
  showPromptLogModal: boolean
  showAgentLogModal: boolean
  showMessageLogModal: boolean
  showAppConfigureFeaturesModal: boolean
}

type Action = {
  setAppDetail: (appDetail?: App & Partial<AppSSO>) => void
  setAppSidebarExpand: (state: string) => void
  setCurrentLogItem: (item?: IChatItem) => void
  setCurrentLogModalActiveTab: (tab: string) => void
  setShowPromptLogModal: (showPromptLogModal: boolean) => void
  setShowAgentLogModal: (showAgentLogModal: boolean) => void
  setShowMessageLogModal: (showMessageLogModal: boolean) => void
  setShowAppConfigureFeaturesModal: (showAppConfigureFeaturesModal: boolean) => void
}

export const useStore = create<State & Action>(set => ({
  appDetail: undefined,
  setAppDetail: appDetail => set(() => ({ appDetail })),
  appSidebarExpand: '',
  setAppSidebarExpand: appSidebarExpand => set(() => ({ appSidebarExpand })),
  currentLogItem: undefined,
  currentLogModalActiveTab: 'DETAIL',
  setCurrentLogItem: currentLogItem => set(() => ({ currentLogItem })),
  setCurrentLogModalActiveTab: currentLogModalActiveTab => set(() => ({ currentLogModalActiveTab })),
  showPromptLogModal: false,
  setShowPromptLogModal: showPromptLogModal => set(() => ({ showPromptLogModal })),
  showAgentLogModal: false,
  setShowAgentLogModal: showAgentLogModal => set(() => ({ showAgentLogModal })),
  showMessageLogModal: false,
  setShowMessageLogModal: showMessageLogModal => set(() => {
    if (showMessageLogModal) {
      return { showMessageLogModal }
    }
    else {
      return {
        showMessageLogModal,
        currentLogModalActiveTab: 'DETAIL',
      }
    }
  }),
  showAppConfigureFeaturesModal: false,
  setShowAppConfigureFeaturesModal: showAppConfigureFeaturesModal => set(() => ({ showAppConfigureFeaturesModal })),
}))
