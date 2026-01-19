'use client'

import type { FC } from 'react'
import {
  RiFileAddLine,
  RiFolderAddLine,
  RiUploadLine,
} from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'
import { useFileOperations } from '../hooks/use-file-operations'
import MenuItem from './menu-item'

type BlankAreaMenuProps = {
  onClose: () => void
  className?: string
}

const BlankAreaMenu: FC<BlankAreaMenuProps> = ({
  onClose,
  className,
}) => {
  const { t } = useTranslation('workflow')

  const {
    fileInputRef,
    isLoading,
    handleNewFile,
    handleNewFolder,
    handleFileChange,
  } = useFileOperations({ nodeId: 'root', onClose })

  return (
    <div className={cn(
      'min-w-[180px] rounded-xl border-[0.5px] border-components-panel-border',
      'bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-[5px]',
      className,
    )}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />

      <MenuItem
        icon={RiFileAddLine}
        label={t('skillSidebar.menu.newFile')}
        onClick={handleNewFile}
        disabled={isLoading}
      />
      <MenuItem
        icon={RiFolderAddLine}
        label={t('skillSidebar.menu.newFolder')}
        onClick={handleNewFolder}
        disabled={isLoading}
      />

      <div className="my-1 h-px bg-divider-subtle" />

      <MenuItem
        icon={RiUploadLine}
        label={t('skillSidebar.menu.uploadFile')}
        onClick={() => fileInputRef.current?.click()}
        disabled={isLoading}
      />
    </div>
  )
}

export default React.memo(BlankAreaMenu)
