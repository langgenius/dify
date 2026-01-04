'use client'
import type { FC } from 'react'
import { noop } from 'es-toolkit/function'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Checkbox from '@/app/components/base/checkbox'
import { FileTypeIcon } from '@/app/components/base/file-uploader'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'
import TagInput from '@/app/components/base/tag-input'
import { cn } from '@/utils/classnames'
import { SupportUploadFileTypes } from '../../../types'

type Props = {
  type: SupportUploadFileTypes.image | SupportUploadFileTypes.document | SupportUploadFileTypes.audio | SupportUploadFileTypes.video | SupportUploadFileTypes.custom
  selected: boolean
  onToggle: (type: SupportUploadFileTypes) => void
  onCustomFileTypesChange?: (customFileTypes: string[]) => void
  customFileTypes?: string[]
}

const FileTypeItem: FC<Props> = ({
  type,
  selected,
  onToggle,
  customFileTypes = [],
  onCustomFileTypesChange = noop,
}) => {
  const { t } = useTranslation()

  const handleOnSelect = useCallback(() => {
    onToggle(type)
  }, [onToggle, type])

  const isCustomSelected = type === SupportUploadFileTypes.custom && selected

  return (
    <div
      className={cn(
        'cursor-pointer select-none rounded-lg border border-components-option-card-option-border bg-components-option-card-option-bg',
        !isCustomSelected && 'px-3 py-2',
        selected && 'border-[1.5px] border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg',
        !selected && 'hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover',
      )}
      onClick={handleOnSelect}
    >
      {isCustomSelected
        ? (
            <div>
              <div className="flex items-center border-b border-divider-subtle p-3 pb-2">
                <FileTypeIcon className="shrink-0" type={type} size="lg" />
                <div className="system-sm-medium mx-2 grow text-text-primary">{t(`variableConfig.file.${type}.name`, { ns: 'appDebug' })}</div>
                <Checkbox className="shrink-0" checked={selected} />
              </div>
              <div className="p-3" onClick={e => e.stopPropagation()}>
                <TagInput
                  items={customFileTypes}
                  onChange={onCustomFileTypesChange}
                  placeholder={t('variableConfig.file.custom.createPlaceholder', { ns: 'appDebug' })!}
                />
              </div>
            </div>
          )
        : (
            <div className="flex items-center">
              <FileTypeIcon className="shrink-0" type={type} size="lg" />
              <div className="mx-2 grow">
                <div className="system-sm-medium text-text-primary">{t(`variableConfig.file.${type}.name`, { ns: 'appDebug' })}</div>
                <div className="system-2xs-regular-uppercase mt-1 text-text-tertiary">{type !== SupportUploadFileTypes.custom ? FILE_EXTS[type].join(', ') : t('variableConfig.file.custom.description', { ns: 'appDebug' })}</div>
              </div>
              <Checkbox className="shrink-0" checked={selected} />
            </div>
          )}

    </div>
  )
}

export default React.memo(FileTypeItem)
