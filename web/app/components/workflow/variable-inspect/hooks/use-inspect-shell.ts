import { createContext, use } from 'react'

type InspectShellContextValue = {
  closeLeftPane: () => void
  isNarrow: boolean
  onClose: () => void
  openLeftPane: () => void
}

export const InspectShellContext = createContext<InspectShellContextValue | null>(null)

export default function useInspectShell() {
  const context = use(InspectShellContext)

  if (!context)
    throw new Error('useInspectShell must be used within InspectShell')

  return context
}
