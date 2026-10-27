import type { ReactNode } from 'react'
import { HooksStoreContextProvider } from '../hooks-store/provider'
import { useInspectVarsCrudCommon } from '../hooks/use-inspect-vars-crud-common'

// Compose the same inspector owner and facade as the editor providers.
export function InspectVarsProvider({ children }: { children: ReactNode }) {
  const inspect = useInspectVarsCrudCommon()
  return <HooksStoreContextProvider {...inspect}>{children}</HooksStoreContextProvider>
}
