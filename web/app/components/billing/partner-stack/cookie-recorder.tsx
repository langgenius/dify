'use client'

import { useEffect } from 'react'
import { IS_CLOUD_EDITION } from '@/config'
import usePSInfo from './use-ps-info'

const PartnerStackCookieRecorder = () => {
  const { psPartnerKey, psClickId, saveOrUpdate } = usePSInfo()

  useEffect(() => {
    if (!IS_CLOUD_EDITION)
      return
    saveOrUpdate()
  }, [psPartnerKey, psClickId, saveOrUpdate])

  return null
}

export default PartnerStackCookieRecorder
