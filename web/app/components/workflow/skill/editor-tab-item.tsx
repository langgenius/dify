'use client'

import type { FC } from 'react'
import type { FileAppearanceType } from '@/app/components/base/file-uploader/types'
import { RiCloseLine } from '@remixicon/react'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import FileTypeIcon from '@/app/components/base/file-uploader/file-type-icon'
import { cn } from '@/utils/classnames'
import { getFileIconType } from './utils/file-utils'

type EditorTabItemProps = {
  fileId: string
  name: string
  isActive: boolean
  isDirty: boolean
  isPreview: boolean
  onClick: (fileId: string) => void
  onClose: (fileId: string) => void
  onDoubleClick: (fileId: string) => void
}

const EditorTabItem: FC<EditorTabItemProps> = ({
  fileId,
  name,
  isActive,
  isDirty,
  isPreview,
  onClick,
  onClose,
  onDoubleClick,
}) => {
  const { t } = useTranslation()
  const iconType = getFileIconType(name)

  const handleClick = useCallback(() => {
    onClick(fileId)
  }, [onClick, fileId])

  const handleDoubleClick = useCallback(() => {
    if (isPreview)
      onDoubleClick(fileId)
  }, [onDoubleClick, fileId, isPreview])

  const handleClose = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onClose(fileId)
  }, [onClose, fileId])

  return (
    <div
      className={cn(
        'group relative flex shrink-0 items-center border-r border-components-panel-border-subtle',
        isActive ? 'bg-components-panel-bg' : 'bg-transparent hover:bg-state-base-hover',
      )}
    >
      <button
        type="button"
        className={cn(
          'flex items-center gap-1.5 px-2.5 pb-2 pt-2.5',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-components-input-border-active',
        )}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        <div className="relative flex size-5 shrink-0 items-center justify-center">
          <FileTypeIcon type={iconType as FileAppearanceType} size="sm" />
          {isDirty && (
            <span className="absolute -bottom-px -right-px size-[7px] rounded-full border border-white bg-text-warning-secondary" />
          )}
        </div>

        <span
          className={cn(
            'max-w-40 truncate text-[13px] font-normal leading-4',
            isPreview && 'italic',
            isActive
              ? 'text-text-primary'
              : 'text-text-tertiary',
          )}
        >
          {name}
        </span>
      </button>

      <button
        type="button"
        className={cn(
          'mr-1 flex size-4 items-center justify-center rounded-[6px] text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-components-input-border-active',
          isActive ? 'opacity-100' : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100',
        )}
        aria-label={t('operation.close', { ns: 'common' })}
        onClick={handleClose}
      >
        <RiCloseLine className="size-4" aria-hidden="true" />
      </button>
    </div>
  )
}

export default React.memo(EditorTabItem)
