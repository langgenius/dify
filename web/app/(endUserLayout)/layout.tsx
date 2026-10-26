import type { ReactNode } from 'react'
import EndUserLayout from '@/app/components/end-user/layout'

export default function Layout({ children }: { children: ReactNode }) {
  return <EndUserLayout>{children}</EndUserLayout>
}
