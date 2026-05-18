'use client'
import type { FC } from 'react'
import type { FileAppearanceTypeEnum } from '@/app/components/base/file-uploader/types'
import { RiArrowRightUpLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import FileIcon from '@/app/components/base/file-uploader/file-type-icon'

type Props = {
  docType: FileAppearanceTypeEnum
  docTitle: string
  showDetailModal: () => void
}
const i18nPrefix = ''

const ResultItemFooter: FC<Props> = ({
  docType,
  docTitle,
  showDetailModal,
}) => {
  const { t } = useTranslation()

  return (
    <div className="mt-3 flex h-10 items-center justify-between border-t border-divider-subtle pr-2 pl-3">
      <div className="flex grow items-center space-x-1">
        <FileIcon type={docType} size="sm" />
        <span className="w-0 grow truncate text-[13px] font-normal text-text-secondary">
          {docTitle}
        </span>
      </div>
      <button
        type="button"
        className="flex cursor-pointer items-center space-x-1 border-none bg-transparent p-0 text-left text-text-tertiary"
        onClick={showDetailModal}
      >
        <div className="text-xs uppercase">{t(`${i18nPrefix}open`, { ns: 'datasetHitTesting' })}</div>
        <RiArrowRightUpLine className="size-3.5" aria-hidden />
      </button>
    </div>
  )
}

export default React.memo(ResultItemFooter)
