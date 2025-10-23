import { createContext } from 'use-context-selector'
import type { App, InstalledApp } from '@/models/explore'
import { noop } from 'lodash-es'

export type CurrentTryAppParams = {
  appId: string
  app: App
}

type IExplore = {
  controlUpdateInstalledApps: number
  setControlUpdateInstalledApps: (controlUpdateInstalledApps: number) => void
  hasEditPermission: boolean
  installedApps: InstalledApp[]
  setInstalledApps: (installedApps: InstalledApp[]) => void
  isFetchingInstalledApps: boolean
  setIsFetchingInstalledApps: (isFetchingInstalledApps: boolean) => void
  currentApp?: CurrentTryAppParams
  isShowTryAppPanel: boolean
  setShowTryAppPanel: (showTryAppPanel: boolean, params?: CurrentTryAppParams) => void
}

const ExploreContext = createContext<IExplore>({
  controlUpdateInstalledApps: 0,
  setControlUpdateInstalledApps: noop,
  hasEditPermission: false,
  installedApps: [],
  setInstalledApps: noop,
  isFetchingInstalledApps: false,
  setIsFetchingInstalledApps: noop,
  isShowTryAppPanel: false,
  setShowTryAppPanel: noop,
  currentApp: undefined,
})

export default ExploreContext
