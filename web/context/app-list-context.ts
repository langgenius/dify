import type { SetTryAppPanel, TryAppSelection } from '@/types/try-app'
import { noop } from 'es-toolkit/function'
import { createContext } from 'use-context-selector'

type Props = {
  currentApp?: TryAppSelection
  isShowTryAppPanel: boolean
  setShowTryAppPanel: SetTryAppPanel
  controlHideCreateFromTemplatePanel: number
}

const AppListContext = createContext<Props>({
  isShowTryAppPanel: false,
  setShowTryAppPanel: noop,
  currentApp: undefined,
  controlHideCreateFromTemplatePanel: 0,
})

export default AppListContext
