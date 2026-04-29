import type { ReactNode } from 'react'
import { AuthPublicRouteGuard } from '@/app/components/auth-public-route-guard'

const AuthLayout = ({ children }: { children: ReactNode }) => {
  return (
    <AuthPublicRouteGuard>
      {children}
    </AuthPublicRouteGuard>
  )
}

export default AuthLayout
