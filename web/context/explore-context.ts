import type { App } from '@/models/explore'
import { noop } from 'es-toolkit/function'
import { createContext } from 'use-context-selector'

export type CurrentTryAppParams = {
  appId: string
  app: App
}

export type IExplore = {
  hasEditPermission: boolean
  currentApp?: CurrentTryAppParams
  isShowTryAppPanel: boolean
  setShowTryAppPanel: (showTryAppPanel: boolean, params?: CurrentTryAppParams) => void
}

const ExploreContext = createContext<IExplore>({
  hasEditPermission: false,
  isShowTryAppPanel: false,
  setShowTryAppPanel: noop,
  currentApp: undefined,
})

export default ExploreContext
