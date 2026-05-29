'use client'

import type { FC, ReactNode } from 'react'
import RootLoading from '@/app/loading'
import dynamic from '@/next/dynamic'

const ClientAppContextProvider = dynamic(
  () => import('./app-context-provider').then(mod => mod.AppContextProvider),
  {
    ssr: false,
    loading: () => <RootLoading />,
  },
)

type AppContextProviderClientOnlyProps = {
  children: ReactNode
}

export const AppContextProviderClientOnly: FC<AppContextProviderClientOnlyProps> = ({ children }) => {
  return (
    <ClientAppContextProvider>
      {children}
    </ClientAppContextProvider>
  )
}
