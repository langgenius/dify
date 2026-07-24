'use client'
import type { FC } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useEffect } from 'react'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import usePSInfo from './use-ps-info'

const PartnerStack: FC = () => {
  const { data: deploymentEdition } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: ({ deployment_edition }) => deployment_edition,
  })
  const isCloudEdition = deploymentEdition === 'CLOUD'
  const { saveOrUpdate, bind } = usePSInfo()
  const hasProcessedRef = React.useRef(false)
  useEffect(() => {
    if (!isCloudEdition || hasProcessedRef.current) return
    hasProcessedRef.current = true
    // Save PartnerStack info in cookie first. Because if user hasn't logged in, redirecting to login page would cause lose the partnerStack info in URL.
    saveOrUpdate()
    // bind PartnerStack info after user logged in
    bind()
  }, [bind, isCloudEdition, saveOrUpdate])

  return null
}
export default React.memo(PartnerStack)
