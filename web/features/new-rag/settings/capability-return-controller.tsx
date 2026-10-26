'use client'

import { useAtomValue } from 'jotai'
import { useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from '@/next/navigation'
import { parseKnowledgeModelCapability, validateNewKnowledgeReturnTo } from '../routes'
import { knowledgeSettingsHasDraftAtom } from './state/draft'
import { knowledgeSettingsSpaceIdAtom } from './state/inputs'
import { knowledgeSettingsSettingsAtom } from './state/queries'
import { knowledgeSettingsHasPendingSaveAtom } from './state/workflow'

export function CapabilityReturnController() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const knowledgeSpaceId = useAtomValue(knowledgeSettingsSpaceIdAtom)
  const settings = useAtomValue(knowledgeSettingsSettingsAtom)
  const hasDraft = useAtomValue(knowledgeSettingsHasDraftAtom)
  const isSaving = useAtomValue(knowledgeSettingsHasPendingSaveAtom)
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
    if (returnWasBlockedRef.current && available && !hasDraft && !isSaving) router.replace(returnTo)
  }, [hasDraft, isSaving, returnCapability, returnTo, router, settings])

  return null
}
