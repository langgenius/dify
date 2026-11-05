import type { ReactNode } from 'react'
import type { Viewport } from '@/next'

export const viewport: Viewport = {
  viewportFit: 'cover',
}

export default function HumanInputLayout({ children }: { children: ReactNode }) {
  return children
}
