import type { InstalledApp } from '@/models/explore'
import { createSelectorCtx } from '@/utils/context'

type IExplore = {
  controlUpdateInstalledApps: number
  setControlUpdateInstalledApps: (controlUpdateInstalledApps: number) => void
  hasEditPermission: boolean
  installedApps: InstalledApp[]
  setInstalledApps: (installedApps: InstalledApp[]) => void
}

const [,, ExploreContext] = createSelectorCtx<IExplore>()

export default ExploreContext
