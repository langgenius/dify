import type { ReactNode } from 'react'
import { InstanceDetail } from '@/features/deployments/detail'

export default async function InstanceDetailLayout({ children, params }: {
  children: ReactNode
  params: Promise<{ appInstanceId: string }>
}) {
  const { appInstanceId } = await params

  return (
    <InstanceDetail appInstanceId={appInstanceId}>
      {children}
    </InstanceDetail>
  )
}
