import { createContext } from 'use-context-selector'
import type { InstalledApp } from '@/models/explore'

type IExplore = {
  controlUpdateInstalledApps: number
  setControlUpdateInstalledApps: (controlUpdateInstalledApps: number) => void
  hasEditPermission: boolean
  installedApps: InstalledApp[]
  setInstalledApps: (installedApps: InstalledApp[]) => void
}

const ExploreContext = createContext<IExplore>({
  controlUpdateInstalledApps: 0,
  setControlUpdateInstalledApps: () => { },
  hasEditPermission: false,
  installedApps: [],
  setInstalledApps: () => { },
})

export default ExploreContext
