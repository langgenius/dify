'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { SupportUploadFileTypes } from '../../../types'
import cn from '@/utils/classnames'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'

type Props = {
  type: SupportUploadFileTypes.image | SupportUploadFileTypes.document | SupportUploadFileTypes.audio | SupportUploadFileTypes.video
  selected: boolean
  onSelect: (type: SupportUploadFileTypes) => void
}

const FileTypeItem: FC<Props> = ({
  type,
  selected,
  onSelect,
}) => {
  const { t } = useTranslation()

  const handleOnSelect = useCallback(() => {
    if (!selected)
      onSelect(type)
  }, [selected, onSelect, type])

  return (
    <div
      className={cn(
        'py-2 px-3 rounded-lg bg-components-option-card-option-bg border border-components-option-card-option-border',
        selected && 'border-[1.5px] bg-components-option-card-option-selected-bg border-components-option-card-option-selected-border',
        !selected && 'cursor-pointer hover:bg-components-option-card-option-bg-hover hover:border-components-option-card-option-border-hover',
      )}
      onClick={handleOnSelect}
    >
      <div className='flex items-center'>
        {/* TODO: Wait File type icon */}
        <span className='shrink-0 w-4 h-4 bg-[#00B2EA]'></span>
        <div className='ml-2'>
          <div className='text-text-primary system-sm-medium'>{t(`appDebug.variableConig.file.${type}.name`)}</div>
          <div className='mt-1 text-text-tertiary system-2xs-regular-uppercase'>{FILE_EXTS[type].join(', ')}</div>
        </div>
      </div>
    </div>
  )
}

export default React.memo(FileTypeItem)
