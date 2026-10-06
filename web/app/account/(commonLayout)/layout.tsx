import * as React from 'react'
import { ConsoleContextProviders, ConsoleRuntimeProviders } from '@/app/(commonLayout)/providers'
import HeaderWrapper from '@/app/components/header/header-wrapper'
import Header from './header'

export default async function Layout({ children }: { children: React.ReactNode }) {
  return (
    <React.Fragment>
      <ConsoleRuntimeProviders>
        <div className="flex h-full flex-col overflow-hidden bg-background-body">
          <ConsoleContextProviders>
            <HeaderWrapper>
              <Header />
            </HeaderWrapper>
            <div className="relative flex h-0 min-h-0 shrink-0 grow flex-col overflow-y-auto bg-components-panel-bg">
              {children}
            </div>
          </ConsoleContextProviders>
        </div>
      </ConsoleRuntimeProviders>
    </React.Fragment>
  )
}
