import type { CurrentTryAppParams } from './explore-context'
import { noop } from 'es-toolkit/function'
import { createContext } from 'use-context-selector'

type Props = {
  currentApp?: CurrentTryAppParams
  isShowTryAppPanel: boolean
  setShowTryAppPanel: (showTryAppPanel: boolean, params?: CurrentTryAppParams) => void
  controlHideCreateFromTemplatePanel: number
}

const AppListContext = createContext<Props>({
  isShowTryAppPanel: false,
  setShowTryAppPanel: noop,
  currentApp: undefined,
  controlHideCreateFromTemplatePanel: 0,
})

export default AppListContext
