import type { FC } from 'react'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import FileTypeIcon from '@/app/components/base/file-uploader/file-type-icon'
import { FileAppearanceTypeEnum } from '@/app/components/base/file-uploader/types'
import { formatFileSize } from '@/utils/format'

type UnsupportedFileDownloadProps = {
  name: string
  size?: number
  downloadUrl?: string
}

const UnsupportedFileDownload: FC<UnsupportedFileDownloadProps> = ({ name, size, downloadUrl }) => {
  const { t } = useTranslation('workflow')
  const fileSize = size ? formatFileSize(size) : ''

  const handleDownload = useCallback(() => {
    if (!downloadUrl || typeof window === 'undefined')
      return
    window.open(downloadUrl, '_blank', 'noopener,noreferrer')
  }, [downloadUrl])

  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex w-full max-w-[360px] flex-col items-center gap-3 pb-0 pr-2 pt-1">
        <div className="flex flex-col items-center gap-1">
          <FileTypeIcon type={FileAppearanceTypeEnum.custom} size="xl" className="size-16 text-text-tertiary" />
          <div className="flex flex-col items-center gap-1 text-center">
            <p className="system-md-medium text-text-secondary">{name}</p>
            {fileSize && (
              <p className="system-xs-regular text-text-tertiary">{fileSize}</p>
            )}
          </div>
        </div>
        <div className="h-px w-64 bg-components-panel-border-subtle" />
        <p className="system-sm-regular text-center text-text-tertiary">
          {t('skillEditor.unsupportedPreview')}
        </p>
        <Button
          variant="primary"
          size="medium"
          onClick={handleDownload}
          disabled={!downloadUrl}
        >
          {t('operation.download', { ns: 'common' })}
        </Button>
      </div>
    </div>
  )
}

export default React.memo(UnsupportedFileDownload)
