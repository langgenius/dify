'use client'

// Icon rendering for tree nodes (folder/file icons with dirty indicator)

import type { FC } from 'react'
import type { FileAppearanceType } from '@/app/components/base/file-uploader/types'
import { RiFolderLine, RiFolderOpenLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import FileTypeIcon from '@/app/components/base/file-uploader/file-type-icon'
import { cn } from '@/utils/classnames'
import { getFileIconType } from '../utils/file-utils'

type TreeNodeIconProps = {
  isFolder: boolean
  isOpen: boolean
  fileName: string
  isDirty: boolean
  onToggle?: (e: React.MouseEvent) => void
}

export const TreeNodeIcon: FC<TreeNodeIconProps> = ({
  isFolder,
  isOpen,
  fileName,
  isDirty,
  onToggle,
}) => {
  const { t } = useTranslation('workflow')

  if (isFolder) {
    return (
      <button
        type="button"
        tabIndex={-1}
        onClick={onToggle}
        aria-label={t('skillSidebar.toggleFolder')}
        className={cn(
          'flex size-full items-center justify-center rounded',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-components-input-border-active',
        )}
      >
        {isOpen
          ? <RiFolderOpenLine className="size-4 text-text-accent" aria-hidden="true" />
          : <RiFolderLine className="size-4 text-text-secondary" aria-hidden="true" />}
      </button>
    )
  }

  const fileIconType = getFileIconType(fileName)

  return (
    <div className="relative flex size-full items-center justify-center">
      <FileTypeIcon type={fileIconType as FileAppearanceType} size="sm" />
      {isDirty && (
        <span className="absolute -bottom-px -right-px size-[7px] rounded-full border border-white bg-text-warning-secondary" />
      )}
    </div>
  )
}
