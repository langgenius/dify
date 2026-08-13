/* oxlint-disable react/only-export-components -- Next.js requires metadata and layout exports in the route file. */
import type { PropsWithChildren } from 'react'
import { getRouteMetadata } from '@/app/route-metadata'

export function generateMetadata() {
  return getRouteMetadata('login', ($) => $.signBtn)
}

export default function OAuthCallbackLayout({ children }: PropsWithChildren) {
  return children
}
