'use client'

import type { FC } from 'react'
import type { NodeApi, TreeApi } from 'react-arborist'
import type { TreeNodeData } from '../type'
import {
  RiDeleteBinLine,
  RiEdit2Line,
} from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Confirm from '@/app/components/base/confirm'
import { cn } from '@/utils/classnames'
import { useFileOperations } from '../hooks/use-file-operations'

type MenuItemProps = {
  icon: React.ElementType
  label: string
  onClick: () => void
  disabled?: boolean
}

const MenuItem: React.FC<MenuItemProps> = ({ icon: Icon, label, onClick, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={cn(
      'flex w-full items-center gap-2 rounded-lg px-3 py-2',
      'hover:bg-state-base-hover disabled:cursor-not-allowed disabled:opacity-50',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-components-input-border-active',
    )}
  >
    <Icon className="size-4 text-text-tertiary" aria-hidden="true" />
    <span className="system-sm-regular text-text-secondary">
      {label}
    </span>
  </button>
)

type FileItemMenuProps = {
  nodeId: string
  onClose: () => void
  className?: string
  treeRef?: React.RefObject<TreeApi<TreeNodeData> | null>
  node?: NodeApi<TreeNodeData>
}

const FileItemMenu: FC<FileItemMenuProps> = ({
  nodeId,
  onClose,
  className,
  treeRef,
  node,
}) => {
  const { t } = useTranslation('workflow')

  const {
    showDeleteConfirm,
    isLoading,
    isDeleting,
    handleRename,
    handleDeleteClick,
    handleDeleteConfirm,
    handleDeleteCancel,
  } = useFileOperations({ nodeId, onClose, treeRef, node })

  return (
    <div className={cn(
      'min-w-[180px] rounded-xl border-[0.5px] border-components-panel-border',
      'bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-[5px]',
      className,
    )}
    >
      <MenuItem
        icon={RiEdit2Line}
        label={t('skillSidebar.menu.rename')}
        onClick={handleRename}
        disabled={isLoading}
      />
      <button
        type="button"
        onClick={handleDeleteClick}
        disabled={isLoading}
        className={cn(
          'flex w-full items-center gap-2 rounded-lg px-3 py-2',
          'hover:bg-state-destructive-hover disabled:cursor-not-allowed disabled:opacity-50',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-components-input-border-active',
          'group',
        )}
      >
        <RiDeleteBinLine className="size-4 text-text-tertiary group-hover:text-text-destructive" aria-hidden="true" />
        <span className="system-sm-regular text-text-secondary group-hover:text-text-destructive">
          {t('skillSidebar.menu.delete')}
        </span>
      </button>

      <Confirm
        isShow={showDeleteConfirm}
        type="danger"
        title={t('skillSidebar.menu.fileDeleteConfirmTitle')}
        content={t('skillSidebar.menu.fileDeleteConfirmContent')}
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
        isLoading={isDeleting}
      />
    </div>
  )
}

export default React.memo(FileItemMenu)
