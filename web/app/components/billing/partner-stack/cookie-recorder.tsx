'use client'

import { useSuspenseQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import usePSInfo from './use-ps-info'

export function PartnerStackCookieRecorder() {
  const { data: deploymentEdition } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: ({ deployment_edition }) => deployment_edition,
  })

  if (deploymentEdition !== 'CLOUD') return null

  return <CookieRecorder />
}

function CookieRecorder() {
  const { saveOrUpdate } = usePSInfo()

  useEffect(() => {
    saveOrUpdate()
  }, [saveOrUpdate])

  return null
}
