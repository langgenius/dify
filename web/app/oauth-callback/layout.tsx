import type { PropsWithChildren } from 'react'
import { getRouteMetadata } from '@/app/route-metadata'

export function generateMetadata() {
  return getRouteMetadata('login', ($) => $.signBtn)
}

export default function OAuthCallbackLayout({ children }: PropsWithChildren) {
  return children
}
