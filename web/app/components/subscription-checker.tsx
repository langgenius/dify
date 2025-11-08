'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useGlobalPublicStore } from '@/context/global-public-context'

const SubscriptionChecker = ({ children }: { children: React.ReactNode }) => {
  const router = useRouter()
  const { isGlobalPending, systemFeatures, userProfile } = useGlobalPublicStore()

  useEffect(() => {
    if (!isGlobalPending && systemFeatures.require_subscription && userProfile.subscription_status !== 'active')
      router.push('/pricing')
  }, [isGlobalPending, systemFeatures.require_subscription, userProfile.subscription_status, router])

  return <>{children}</>
}

export default SubscriptionChecker
