'use client'
import type { FileAppearanceTypeEnum } from '@/app/components/base/file-uploader/types'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import FileIcon from '@/app/components/base/file-uploader/file-type-icon'

type ResultItemFooterProps = {
  readonly docType: FileAppearanceTypeEnum
  readonly docTitle: string
}

export const ResultItemFooter = memo(({ docType, docTitle }: ResultItemFooterProps) => {
  const { t } = useTranslation(['datasetHitTesting'])

  return (
    <span className="mt-3 flex h-10 items-center justify-between border-t border-divider-subtle pr-2 pl-3">
      <span className="flex grow items-center space-x-1">
        <FileIcon type={docType} size="sm" />
        <span className="w-0 grow truncate text-[13px] font-normal text-text-secondary">
          {docTitle}
        </span>
      </span>
      <span className="flex items-center space-x-1 text-text-tertiary">
        <span className="text-xs uppercase">{t(($) => $.open, { ns: 'datasetHitTesting' })}</span>
        <span aria-hidden className="i-ri-arrow-right-up-line size-3.5" />
      </span>
    </span>
  )
})
