import { createContext } from 'use-context-selector'
import type { InstalledApp } from '@/models/explore'
import { noop } from 'lodash-es'

type IExplore = {
  controlUpdateInstalledApps: number
  setControlUpdateInstalledApps: (controlUpdateInstalledApps: number) => void
  hasEditPermission: boolean
  installedApps: InstalledApp[]
  setInstalledApps: (installedApps: InstalledApp[]) => void
  isFetchingInstalledApps: boolean
  setIsFetchingInstalledApps: (isFetchingInstalledApps: boolean) => void
}

const ExploreContext = createContext<IExplore>({
  controlUpdateInstalledApps: 0,
  setControlUpdateInstalledApps: noop,
  hasEditPermission: false,
  installedApps: [],
  setInstalledApps: noop,
  isFetchingInstalledApps: false,
  setIsFetchingInstalledApps: noop,
})

export default ExploreContext
