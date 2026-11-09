import type { PropsWithChildren } from 'react'
import { getRouteMetadata } from '@/app/route-metadata'

export function generateMetadata() {
  return getRouteMetadata('login', ($) => $.changePassword)
}

export default function SetPasswordLayout({ children }: PropsWithChildren) {
  return children
}
