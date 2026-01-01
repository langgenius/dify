'use client'

import { useEffect, useRef } from 'react'
import {
  fetchAceDataCloudOAuthSession,
  isAceDataCloudOAuthSessionExpiringSoon,
  loadAceDataCloudOAuthSession,
  saveAceDataCloudOAuthSession,
} from '@/service/acedatacloud-oauth'

const AceDataCloudOAuthInitializer = () => {
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current)
      return
    startedRef.current = true

    const existing = loadAceDataCloudOAuthSession()
    if (existing && !isAceDataCloudOAuthSessionExpiringSoon(existing))
      return

    fetchAceDataCloudOAuthSession()
      .then((session) => {
        if (!session?.access_token)
          return
        saveAceDataCloudOAuthSession(session)
      })
      .catch(() => {})
  }, [])

  return null
}

export default AceDataCloudOAuthInitializer
