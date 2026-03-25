'use client'
import type { FC } from 'react'
import {
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiDeleteBinLine,
  RiEditLine,
  RiFolderLine,
  RiFolderOpenLine,
} from '@remixicon/react'
import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'

export type IFolderItemProps = {
  id: string
  name: string
  isExpanded: boolean
  isEmpty: boolean
  onToggleExpand: () => void
  onRename: (newName: string) => void
  onDelete: () => void
  children?: React.ReactNode
}

const FolderItem: FC<IFolderItemProps> = ({
  name,
  isExpanded,
  isEmpty,
  onToggleExpand,
  onRename,
  onDelete,
  children,
}) => {
  const { t } = useTranslation()
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(name)
  const [isHovering, setIsHovering] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleSubmitRename = useCallback(() => {
    const trimmed = editName.trim()
    if (trimmed && trimmed !== name)
      onRename(trimmed)
    else
      setEditName(name)
    setIsEditing(false)
  }, [editName, name, onRename])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter')
      handleSubmitRename()
    else if (e.key === 'Escape') {
      setEditName(name)
      setIsEditing(false)
    }
  }, [handleSubmitRename, name])

  return (
    <div className="mb-0.5">
      <div
        className="group flex h-8 cursor-pointer items-center justify-between rounded-lg px-2 hover:bg-state-base-hover"
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
        onClick={onToggleExpand}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {isExpanded
            ? <RiArrowDownSLine className="size-4 shrink-0 text-text-tertiary" />
            : <RiArrowRightSLine className="size-4 shrink-0 text-text-tertiary" />}
          {isExpanded
            ? <RiFolderOpenLine className="size-4 shrink-0 text-text-secondary" />
            : <RiFolderLine className="size-4 shrink-0 text-text-secondary" />}
          {isEditing
            ? (
              <input
                ref={inputRef}
                className="system-sm-regular ml-1 min-w-0 flex-1 rounded border border-components-input-border-active bg-components-input-bg-active px-1 text-text-primary outline-none"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                onBlur={handleSubmitRename}
                onKeyDown={handleKeyDown}
                onClick={e => e.stopPropagation()}
              />
            )
            : (
              <span className="system-sm-regular ml-1 truncate text-text-secondary">{name}</span>
            )}
        </div>
        {isHovering && !isEditing && (
          <div className="flex shrink-0 items-center gap-0.5">
            <div
              className="flex size-6 items-center justify-center rounded-md hover:bg-state-base-hover-alt"
              title={t('sidebar.folder.rename', { ns: 'explore' })}
              onClick={(e) => {
                e.stopPropagation()
                setEditName(name)
                setIsEditing(true)
              }}
            >
              <RiEditLine className="size-3.5 text-text-tertiary" />
            </div>
            {isEmpty && (
              <div
                className="flex size-6 items-center justify-center rounded-md hover:bg-state-destructive-hover"
                title={t('sidebar.folder.delete', { ns: 'explore' })}
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete()
                }}
              >
                <RiDeleteBinLine className="size-3.5 text-text-tertiary hover:text-text-destructive" />
              </div>
            )}
          </div>
        )}
      </div>
      {isExpanded && (
        <div className="ml-3 border-l border-divider-subtle pl-1">
          {children}
        </div>
      )}
    </div>
  )
}

export default React.memo(FolderItem)

