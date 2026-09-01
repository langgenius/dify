'use client'

import { useAtomValue } from 'jotai'
import { useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from '@/next/navigation'
import { parseKnowledgeModelCapability, validateNewKnowledgeReturnTo } from '../routes'
import { knowledgeSettingsSpaceIdAtom } from './state/inputs'
import { knowledgeSettingsSettingsAtom } from './state/queries'

export function CapabilityReturnController() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const knowledgeSpaceId = useAtomValue(knowledgeSettingsSpaceIdAtom)
  const settings = useAtomValue(knowledgeSettingsSettingsAtom)
  const returnWasBlockedRef = useRef(false)
  const returnInitializedRef = useRef(false)
  const returnCapability = parseKnowledgeModelCapability(searchParams.get('capability'))
  const returnTo = validateNewKnowledgeReturnTo(knowledgeSpaceId, searchParams.get('returnTo'))

  useEffect(() => {
    if (!returnCapability || !returnTo || !settings) return
    const available = settings.capabilities[returnCapability]
    if (!returnInitializedRef.current) {
      returnInitializedRef.current = true
      returnWasBlockedRef.current = !available
      return
    }
    if (returnWasBlockedRef.current && available) router.replace(returnTo)
  }, [returnCapability, returnTo, router, settings])

  return null
}
