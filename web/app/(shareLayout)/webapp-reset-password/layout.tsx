import { AuthShell } from '@/app/components/auth-shell'
import { getRouteMetadata } from '@/app/route-metadata'

export function generateMetadata() {
  return getRouteMetadata('login', ($) => $.resetPassword)
}

export default function WebappResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return <AuthShell>{children}</AuthShell>
}
