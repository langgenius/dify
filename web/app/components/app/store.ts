import type { IChatItem } from '@/app/components/base/chat/chat/type'
import type { App, AppIconType, AppSSO } from '@/types/app'
import { cloneDeep } from 'es-toolkit/compat'
import { shallow } from 'zustand/shallow'
import { createWithEqualityFn } from 'zustand/traditional'
import { updateAppInfo } from '@/service/apps'
import { get as serviceGet } from '@/service/base'

type AppDetail = App & Partial<AppSSO>

type State = {
  appDetails?: Record<string, AppDetail>
  appSidebarExpand: string
  currentLogItem?: IChatItem
  currentLogModalActiveTab: string
  showPromptLogModal: boolean
  showAgentLogModal: boolean
  showMessageLogModal: boolean
  showAppConfigureFeaturesModal: boolean
}

type Action = {
  setAppSidebarExpand: (state: string) => void
  setCurrentLogItem: (item?: IChatItem) => void
  setCurrentLogModalActiveTab: (tab: string) => void
  setShowPromptLogModal: (showPromptLogModal: boolean) => void
  setShowAgentLogModal: (showAgentLogModal: boolean) => void
  setShowMessageLogModal: (showMessageLogModal: boolean) => void
  setShowAppConfigureFeaturesModal: (showAppConfigureFeaturesModal: boolean) => void
}

export const useAppStore = createWithEqualityFn<State & Action>(set => ({
  appDetails: undefined,
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
}), shallow)

const appDetails = (appID: string | undefined) => (state: State) => {
  if (!appID)
    return undefined
  return state.appDetails ? state.appDetails[appID] : undefined
}

export const appStoreSelectors = {
  appDetails,
}

const set = useAppStore.setState

async function fetchAppDetail(appID: string | undefined) {
  if (!appID)
    return null

  const appDetail = await serviceGet<App>(`/apps/${appID}`)
  set(state => ({
    appDetails: {
      ...state.appDetails,
      [appID]: appDetail,
    },
  }))
  return appDetail
}

async function updateAppDetail(updatedDetail: {
  appID: string
  name: string
  icon_type: AppIconType
  icon: string
  icon_background?: string
  description: string
  use_icon_as_answer_icon?: boolean
  max_active_requests?: number | null
}) {
  const appID = updatedDetail.appID
  const currentDetails = useAppStore.getState().appDetails || {}
  const currentDetail = cloneDeep(currentDetails[appID])
  if (!currentDetail)
    return

  set(state => ({
    appDetails: {
      ...state.appDetails,
      [appID]: {
        ...currentDetail,
        ...updatedDetail,
      },
    },
  }))

  return updateAppInfo({
    ...updatedDetail,
    appID,
  }).catch(() => {
    set(state => ({
      appDetails: {
        ...state.appDetails,
        [appID]: currentDetail,
      },
    }))
  })
}

export const appStoreActions = {
  fetchAppDetail,
  updateAppDetail,
}
