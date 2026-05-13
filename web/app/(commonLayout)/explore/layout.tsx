import type { PropsWithChildren } from 'react'
import { redirect } from '@/next/navigation'

/**
 * Explore section is hidden from the product UI; keep routes from rendering by redirecting.
 */
export default function ExploreLayout(props: PropsWithChildren) {
  void props.children
  redirect('/apps')
}
