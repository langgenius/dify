'use client'

import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Toast from '@/app/components/base/toast'
import { consoleClient } from '@/service/client'
import { downloadUrl } from '@/utils/download'

type UseDownloadOperationOptions = {
  appId: string
  nodeId: string
  fileName?: string
  onClose: () => void
}

export function useDownloadOperation({
  appId,
  nodeId,
  fileName,
  onClose,
}: UseDownloadOperationOptions) {
  const { t } = useTranslation('workflow')
  const [isDownloading, setIsDownloading] = useState(false)

  const handleDownload = useCallback(async () => {
    if (!nodeId || !appId)
      return

    onClose()

    setIsDownloading(true)
    try {
      const { download_url } = await consoleClient.appAsset.getFileDownloadUrl({
        params: { appId, nodeId },
      })

      downloadUrl({ url: download_url, fileName })
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
  }, [appId, nodeId, fileName, onClose, t])

  return {
    handleDownload,
    isDownloading,
  }
}
