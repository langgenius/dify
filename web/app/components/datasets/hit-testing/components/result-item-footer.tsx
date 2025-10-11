'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { RiArrowRightUpLine } from '@remixicon/react'
import FileIcon from '@/app/components/base/file-uploader/file-type-icon'
import type { FileAppearanceTypeEnum } from '@/app/components/base/file-uploader/types'

type Props = {
  docType: FileAppearanceTypeEnum
  docTitle: string
  showDetailModal: () => void
}
const i18nPrefix = 'datasetHitTesting'

const ResultItemFooter: FC<Props> = ({
  docType,
  docTitle,
  showDetailModal,
}) => {
  const { t } = useTranslation()

  return (
    <div className="mt-3 flex h-10 items-center justify-between border-t border-divider-subtle pl-3 pr-2">
      <div className="flex grow items-center space-x-1">
        <FileIcon type={docType} size="sm" />
        <span className="w-0 grow truncate text-[13px] font-normal text-text-secondary">
          {docTitle}
        </span>
      </div>
      <div
        className="flex cursor-pointer items-center space-x-1 text-text-tertiary"
        onClick={showDetailModal}
      >
        <div className="text-xs uppercase">{t(`${i18nPrefix}.open`)}</div>
        <RiArrowRightUpLine className="size-3.5" />
      </div>
    </div>
  )
}

export default React.memo(ResultItemFooter)
