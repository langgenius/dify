'use client'
import type { Placement } from '@floating-ui/react'
import type { OnlineDriveFile, OnlineDriveFileTreeItem } from '@/models/pipeline'
import { RiArrowDownSLine, RiArrowRightSLine } from '@remixicon/react'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Checkbox from '@/app/components/base/checkbox'
import Radio from '@/app/components/base/radio/ui'
import Tooltip from '@/app/components/base/tooltip'
import { OnlineDriveFileType } from '@/models/pipeline'
import { cn } from '@/utils/classnames'
import { formatFileSize } from '@/utils/format'
import FileIcon from './file-icon'

type TreeItemProps = {
  treeItem: OnlineDriveFileTreeItem
  isSelected: boolean
  canExpand: boolean
  disabled?: boolean
  isMultipleChoice?: boolean
  onSelect: (file: OnlineDriveFile) => void
  onOpen: (file: OnlineDriveFile) => void
  onToggleExpand: (folderId: string) => void
}

const TreeItem = ({
  treeItem,
  isSelected,
  canExpand,
  disabled = false,
  isMultipleChoice = true,
  onSelect,
  onOpen,
  onToggleExpand,
}: TreeItemProps) => {
  const { t } = useTranslation()
  const { id, name, type, size, depth, isExpanded } = treeItem

  const isBucket = type === OnlineDriveFileType.bucket
  const isFolder = type === OnlineDriveFileType.folder

  const Wrapper = disabled ? Tooltip : React.Fragment
  const wrapperProps = disabled
    ? {
        popupContent: t('onlineDrive.notSupportedFileType', { ns: 'datasetPipeline' }),
        position: 'top-end' as Placement,
        offset: { mainAxis: 4, crossAxis: -104 },
      }
    : {}

  const handleSelect = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation()
      onSelect(treeItem)
    },
    [treeItem, onSelect],
  )

  const handleToggle = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation()
      onToggleExpand(id)
    },
    [id, onToggleExpand],
  )

  const handleClickItem = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation()
      if (disabled)
        return

      // For folders, navigate into them (changes prefix)
      if (isBucket || isFolder) {
        onOpen(treeItem)
        return
      }

      // For files, toggle selection
      onSelect(treeItem)
    },
    [disabled, treeItem, isBucket, isFolder, onOpen, onSelect],
  )

  return (
    <div
      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-[3px] hover:bg-state-base-hover"
      onClick={handleClickItem}
    >
      {/* Indentation */}
      {depth > 0 && (
        <div className="flex shrink-0">
          {Array.from({ length: depth }).map((_, index) => (
            <div key={index} className="w-4" />
          ))}
        </div>
      )}

      {/* Expand/Collapse Arrow */}
      {canExpand
        ? (
            <div
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md hover:bg-components-button-ghost-bg-hover"
              onClick={handleToggle}
            >
              {isExpanded
                ? (
                    <RiArrowDownSLine className="h-4 w-4 text-text-tertiary" />
                  )
                : (
                    <RiArrowRightSLine className="h-4 w-4 text-text-tertiary" />
                  )}
            </div>
          )
        : (
            <div className="h-5 w-5 shrink-0" />
          )}

      {/* Checkbox/Radio */}
      {!isBucket && isMultipleChoice && (
        <Checkbox
          className="shrink-0"
          disabled={disabled}
          id={id}
          checked={isSelected}
          onCheck={handleSelect}
        />
      )}
      {!isBucket && !isMultipleChoice && (
        <Radio
          className="shrink-0"
          disabled={disabled}
          isChecked={isSelected}
          onCheck={handleSelect}
        />
      )}

      {/* File Info */}
      <Wrapper {...wrapperProps}>
        <div
          className={cn(
            'flex grow items-center gap-x-1 overflow-hidden py-0.5',
            disabled && 'opacity-30',
          )}
        >
          <FileIcon type={type} fileName={name} className="shrink-0 transform-gpu" />
          <span className="system-sm-medium grow truncate text-text-secondary" title={name}>
            {name}
          </span>
          {!isFolder && !isBucket && typeof size === 'number' && (
            <span className="system-xs-regular shrink-0 text-text-tertiary">
              {formatFileSize(size)}
            </span>
          )}
        </div>
      </Wrapper>
    </div>
  )
}

export default React.memo(TreeItem)
