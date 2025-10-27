import { createContext } from 'use-context-selector'
import { noop } from 'lodash-es'
import type { CurrentTryAppParams } from './explore-context'

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
