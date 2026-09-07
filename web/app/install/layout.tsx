import type { PropsWithChildren } from 'react'
import { getRouteMetadata } from '@/app/route-metadata'

export function generateMetadata() {
  return getRouteMetadata('login', ($) => $.setAdminAccount)
}

export default function InstallLayout({ children }: PropsWithChildren) {
  return children
}
