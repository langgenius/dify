import type { ReactNode } from 'react'
import { createContext, use } from 'react'
import { FileContextProvider } from '@/app/components/base/file-uploader/store'

const BuilderFileScopeContext = createContext(false)

export const DifyBuilderAttachmentScope = ({ children }: { children: ReactNode }) => {
  const owned = use(BuilderFileScopeContext)
  if (owned) return children
  return (
    <BuilderFileScopeContext value>
      <FileContextProvider>{children}</FileContextProvider>
    </BuilderFileScopeContext>
  )
}
