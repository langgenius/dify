'use client'

// Handles file download operation - opens download URL in new tab

import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Toast from '@/app/components/base/toast'
import { consoleClient } from '@/service/client'

type UseDownloadOperationOptions = {
  appId: string
  nodeId: string
  onClose: () => void
}

export function useDownloadOperation({
  appId,
  nodeId,
  onClose,
}: UseDownloadOperationOptions) {
  const { t } = useTranslation('workflow')
  const [isDownloading, setIsDownloading] = useState(false)

  const handleDownload = useCallback(async () => {
    if (!nodeId || !appId)
      return

    // Close menu immediately before any async operation
    onClose()

    setIsDownloading(true)
    try {
      const { download_url } = await consoleClient.appAsset.getFileDownloadUrl({
        params: { appId, nodeId },
      })

      // Open download URL in new tab (consistent with UnsupportedFileDownload)
      if (typeof window !== 'undefined')
        window.open(download_url, '_blank', 'noopener,noreferrer')
    }
    catch {
      Toast.notify({
        type: 'error',
        message: t('skillSidebar.menu.downloadError'),
      })
    }
    finally {
      setIsDownloading(false)
    }
  }, [appId, nodeId, onClose, t])

  return {
    handleDownload,
    isDownloading,
  }
}
