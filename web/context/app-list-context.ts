import type { TryAppSelection } from '@/types/try-app'
import { noop } from 'es-toolkit/function'
import { createContext } from 'use-context-selector'

type Props = Readonly<{
  openTryAppPanel: (selection: TryAppSelection) => void
}>

const AppListContext = createContext<Props>({
  openTryAppPanel: noop,
})

export default AppListContext
