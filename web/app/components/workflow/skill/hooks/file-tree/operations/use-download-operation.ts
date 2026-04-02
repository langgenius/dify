'use client'

import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/components/base/ui/toast'
import { getFileExtension, isTextLikeFile } from '@/app/components/workflow/skill/utils/file-utils'
import { consoleClient } from '@/service/client'
import { downloadBlob, downloadUrl } from '@/utils/download'

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
  const extension = getFileExtension(fileName)
  const shouldDownloadAsText = !!fileName && isTextLikeFile(extension)

  const handleDownload = useCallback(async () => {
    if (!nodeId || !appId)
      return

    onClose()

    setIsDownloading(true)
    try {
      if (shouldDownloadAsText) {
        const { content } = await consoleClient.appAsset.getFileContent({
          params: { appId, nodeId },
        })
        const textFileName = fileName!
        let rawText = content
        try {
          const parsed = JSON.parse(content) as { content?: string }
          if (typeof parsed?.content === 'string')
            rawText = parsed.content
        }
        catch {
        }

        downloadBlob({
          data: new Blob([rawText], { type: 'text/plain;charset=utf-8' }),
          fileName: textFileName,
        })
      }
      else {
        const { download_url } = await consoleClient.appAsset.getFileDownloadUrl({
          params: { appId, nodeId },
        })

        downloadUrl({ url: download_url, fileName })
      }
    }
    catch {
      toast.error(t('skillSidebar.menu.downloadError'))
    }
    finally {
      setIsDownloading(false)
    }
  }, [appId, nodeId, fileName, onClose, shouldDownloadAsText, t])

  return {
    handleDownload,
    isDownloading,
  }
}
