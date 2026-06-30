import type { ReactNode } from 'react'
import { InstanceDetail } from '@/features/deployments/detail'

export default function InstanceDetailLayout({ children }: {
  children: ReactNode
}) {
  return (
    <InstanceDetail>
      {children}
    </InstanceDetail>
  )
}
