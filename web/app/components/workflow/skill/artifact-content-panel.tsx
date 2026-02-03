'use client'

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { useStore } from '@/app/components/workflow/store'
import { useSandboxFileDownloadUrl } from '@/service/use-sandbox-file'
import { getArtifactPath } from './constants'
import { getFileExtension } from './utils/file-utils'
import ReadOnlyFilePreview from './viewer/read-only-file-preview'

const ArtifactContentPanel = () => {
  const { t } = useTranslation('workflow')
  const activeTabId = useStore(s => s.activeTabId)
  const appId = useStore(s => s.appId)

  const path = activeTabId ? getArtifactPath(activeTabId) : undefined
  const fileName = path?.split('/').pop() ?? ''
  const extension = getFileExtension(fileName)

  const { data: ticket, isLoading } = useSandboxFileDownloadUrl(appId, path)

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-components-panel-bg">
        <Loading type="area" />
      </div>
    )
  }

  if (!ticket?.download_url) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-components-panel-bg text-text-tertiary">
        <span className="system-sm-regular">
          {t('skillSidebar.loadError')}
        </span>
      </div>
    )
  }

  return (
    <div className="h-full w-full overflow-auto bg-components-panel-bg">
      <ReadOnlyFilePreview
        downloadUrl={ticket.download_url}
        fileName={fileName}
        extension={extension}
      />
    </div>
  )
}

export default React.memo(ArtifactContentPanel)
