'use client'

import type { FC } from 'react'
import type { FileAppearanceType } from '@/app/components/base/file-uploader/types'
import { RiCloseLine } from '@remixicon/react'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import FileTypeIcon from '@/app/components/base/file-uploader/file-type-icon'
import { cn } from '@/utils/classnames'
import { getFileIconType } from './utils'

/**
 * EditorTabItem - Single tab item in the tab bar
 *
 * Features:
 * - Click to activate
 * - Close button (shown on hover or when active)
 * - Dirty indicator (orange dot)
 * - File type icon based on extension
 *
 * Design specs from Figma:
 * - Height: 32px (pb-2 pt-2.5 = 18px content + padding)
 * - Font: 13px, medium (500) when active
 * - Icon: 16x16 in 20x20 container
 */

type EditorTabItemProps = {
  fileId: string
  name: string
  isActive: boolean
  isDirty: boolean
  onClick: (fileId: string) => void
  onClose: (fileId: string) => void
}

const EditorTabItem: FC<EditorTabItemProps> = ({
  fileId,
  name,
  isActive,
  isDirty,
  onClick,
  onClose,
}) => {
  const { t } = useTranslation()
  const iconType = getFileIconType(name)

  const handleClick = useCallback(() => {
    onClick(fileId)
  }, [onClick, fileId])

  const handleClose = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onClose(fileId)
  }, [onClose, fileId])

  return (
    <div
      className={cn(
        'group relative flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-components-panel-border-subtle px-2.5 pb-2 pt-2.5',
        isActive ? 'bg-components-panel-bg' : 'bg-transparent hover:bg-state-base-hover',
      )}
      onClick={handleClick}
    >
      {/* Icon with dirty indicator */}
      <div className="relative flex size-5 shrink-0 items-center justify-center">
        <FileTypeIcon type={iconType as FileAppearanceType} size="sm" />
        {/* Dirty indicator dot */}
        {isDirty && (
          <span className="absolute -bottom-px -right-px size-[7px] rounded-full border border-white bg-text-warning-secondary" />
        )}
      </div>

      {/* File name */}
      <span
        className={cn(
          'max-w-40 truncate text-[13px] leading-4',
          isActive
            ? 'font-medium text-text-primary'
            : 'text-text-tertiary',
        )}
      >
        {name}
      </span>

      {/* Close button */}
      <button
        type="button"
        className={cn(
          'ml-0.5 flex size-4 items-center justify-center rounded-[6px] text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
          isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        )}
        aria-label={t('operation.close', { ns: 'common' })}
        onClick={handleClose}
      >
        <RiCloseLine className="size-4" />
      </button>
    </div>
  )
}

export default React.memo(EditorTabItem)
