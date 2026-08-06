'use client'

import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { FullScreenLoading } from '@/app/components/full-screen-loading'
import dynamic from '@/next/dynamic'
import { useRouter, useSearchParams } from '@/next/navigation'

const EDUCATION_REVERIFY_ACTION = 'educationReVerify'
const EDUCATION_PRICING_ACTION = 'educationPricing'

const EducationReverifyFlow = dynamic(
  () => import('./reverify-flow').then((module) => module.EducationReverifyFlow),
  {
    ssr: false,
    loading: FullScreenLoading,
  },
)

function EducationPricingRedirect({ searchParamsString }: { searchParamsString: string }) {
  const router = useRouter()
  const redirectedRef = useRef(false)

  useEffect(() => {
    if (redirectedRef.current) return

    redirectedRef.current = true
    const searchParams = new URLSearchParams(searchParamsString)
    searchParams.delete('action')
    searchParams.set('pricing', 'open')
    router.replace(`/apps?${searchParams.toString()}`)
  }, [router, searchParamsString])

  return <FullScreenLoading />
}

export function EducationExternalActionBoundary({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams()
  const action = searchParams.get('action')

  if (action === EDUCATION_REVERIFY_ACTION) return <EducationReverifyFlow />
  if (action === EDUCATION_PRICING_ACTION)
    return <EducationPricingRedirect searchParamsString={searchParams.toString()} />

  return children
}
