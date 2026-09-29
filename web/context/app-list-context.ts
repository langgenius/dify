import type { RecommendedAppResponse } from '@dify/contracts/api/console/explore/types.gen'
import { noop } from 'es-toolkit/function'
import { createContext } from 'use-context-selector'

type Props = Readonly<{
  openTryAppPanel: (app: RecommendedAppResponse) => void
}>

const AppListContext = createContext<Props>({
  openTryAppPanel: noop,
})

export default AppListContext
