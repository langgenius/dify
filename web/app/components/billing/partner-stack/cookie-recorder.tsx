'use client'

import { useEffect } from 'react'
import usePSInfo from './use-ps-info'

const PartnerStackCookieRecorder = () => {
  const { saveOrUpdate } = usePSInfo()

  useEffect(() => {
    saveOrUpdate()
  }, [saveOrUpdate])

  return null
}

export default PartnerStackCookieRecorder
