import type { PropsWithChildren } from 'react'
import { redirect } from '@/next/navigation'

/**
 * Tools section is hidden from the product UI; prevent rendering via redirect.
 */
export default function ToolsLayout(props: PropsWithChildren) {
  void props.children
  redirect('/apps')
}
