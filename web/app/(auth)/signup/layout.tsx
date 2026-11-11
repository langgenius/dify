import { getRouteMetadata } from '@/app/route-metadata'

export function generateMetadata() {
  return getRouteMetadata('login', ($) => $['signup.createAccount'])
}

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children
}
