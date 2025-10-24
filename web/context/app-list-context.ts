import { createContext } from 'use-context-selector'
import { noop } from 'lodash-es'
import type { CurrentTryAppParams } from './explore-context'

type Props = {
  currentApp?: CurrentTryAppParams
  isShowTryAppPanel: boolean
  setShowTryAppPanel: (showTryAppPanel: boolean, params?: CurrentTryAppParams) => void
}

const AppListContext = createContext<Props>({
  isShowTryAppPanel: false,
  setShowTryAppPanel: noop,
  currentApp: undefined,
})

export default AppListContext
