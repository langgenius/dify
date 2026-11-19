import { getRouteMetadata } from '@/app/route-metadata'

export function generateMetadata() {
  return getRouteMetadata('login', ($) => $.resetPassword)
}

export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return children
}
