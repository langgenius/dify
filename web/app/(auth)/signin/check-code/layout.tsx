import type { PropsWithChildren } from 'react'
import { getRouteMetadata } from '@/app/route-metadata'

export function generateMetadata() {
  return getRouteMetadata('login', ($) => $['checkCode.checkYourEmail'])
}

export default function CheckCodeLayout({ children }: PropsWithChildren) {
  return children
}
