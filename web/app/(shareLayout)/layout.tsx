import type { FC, PropsWithChildren } from 'react'
import WebAppStoreProvider from '@/context/web-app-context'
import AuthSessionBoundary from './components/auth-session-boundary'
import Splash from './components/splash'

const Layout: FC<PropsWithChildren> = ({ children }) => {
  return (
    <div className="h-dvh min-w-75">
      <AuthSessionBoundary>
        <WebAppStoreProvider>
          <Splash>{children}</Splash>
        </WebAppStoreProvider>
      </AuthSessionBoundary>
    </div>
  )
}

export default Layout
