'use client'
import { IS_CLOUD_EDITION } from '@/config'
import type { FC } from 'react'
import React, { useEffect } from 'react'
import usePSInfo from './use-ps-info'

const PartnerStack: FC = () => {
  const { saveOrUpdate, bind } = usePSInfo()
  useEffect(() => {
    if (!IS_CLOUD_EDITION)
      return
    // Save PartnerStack info in cookie first. Because if user hasn't logged in, redirecting to login page would cause lose the partnerStack info in URL.
    saveOrUpdate()
    // bind PartnerStack info after user logged in
    bind()
  }, [])

  return null
}
export default React.memo(PartnerStack)
