'use client'
import type { FC } from 'react'
import {
  RiAddLine,
  RiCloseLine,
  RiFolderLine,
} from '@remixicon/react'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Folder } from '../use-folders'
import { cn } from '@/utils/classnames'

export type IMoveToFolderModalProps = {
  folders: Folder[]
  currentFolderId: string | null
  onSelect: (folderId: string) => void
  onCreateFolder: (name: string) => Folder
  onClose: () => void
}

const MoveToFolderModal: FC<IMoveToFolderModalProps> = ({
  folders,
  currentFolderId,
  onSelect,
  onCreateFolder,
  onClose,
}) => {
  const { t } = useTranslation()
  const [isCreating, setIsCreating] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')

  const handleCreateAndSelect = () => {
    const trimmed = newFolderName.trim()
    if (!trimmed)
      return
    const folder = onCreateFolder(trimmed)
    onSelect(folder.id)
  }

  const availableFolders = folders.filter(f => f.id !== currentFolderId)

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[320px] rounded-xl border border-components-panel-border bg-components-panel-bg p-4 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="system-md-semibold text-text-primary">{t('sidebar.folder.selectFolder', { ns: 'explore' })}</h3>
          <div className="flex size-6 cursor-pointer items-center justify-center rounded-md hover:bg-state-base-hover" onClick={onClose}>
            <RiCloseLine className="size-4 text-text-tertiary" />
          </div>
        </div>

        <div className="max-h-[240px] space-y-1 overflow-y-auto">
          {availableFolders.length === 0 && !isCreating && (
            <div className="py-4 text-center text-text-tertiary system-sm-regular">
              {t('sidebar.folder.noFolder', { ns: 'explore' })}
            </div>
          )}
          {availableFolders.map(folder => (
            <div
              key={folder.id}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 hover:bg-state-base-hover"
              onClick={() => onSelect(folder.id)}
            >
              <RiFolderLine className="size-4 shrink-0 text-text-secondary" />
              <span className="system-sm-regular truncate text-text-secondary">{folder.name}</span>
            </div>
          ))}

          {isCreating && (
            <div className="flex items-center gap-2 px-3 py-1">
              <RiFolderLine className="size-4 shrink-0 text-text-secondary" />
              <input
                autoFocus
                className="system-sm-regular min-w-0 flex-1 rounded border border-components-input-border-active bg-components-input-bg-active px-2 py-1 text-text-primary outline-none"
                placeholder={t('sidebar.folder.defaultName', { ns: 'explore' })}
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter')
                    handleCreateAndSelect()
                  else if (e.key === 'Escape')
                    setIsCreating(false)
                }}
              />
            </div>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-divider-subtle pt-3">
          <div
            className={cn('flex cursor-pointer items-center gap-1 text-text-accent system-sm-medium', isCreating && 'opacity-50')}
            onClick={() => {
              if (!isCreating) {
                setIsCreating(true)
                setNewFolderName('')
              }
            }}
          >
            <RiAddLine className="size-4" />
            <span>{t('sidebar.folder.createNew', { ns: 'explore' })}</span>
          </div>
          <div className="flex gap-2">
            <button
              className="system-sm-medium rounded-lg px-3 py-1.5 text-text-secondary hover:bg-state-base-hover"
              onClick={onClose}
            >
              {t('sidebar.folder.cancel', { ns: 'explore' })}
            </button>
            {isCreating && (
              <button
                className="system-sm-medium rounded-lg bg-components-button-primary-bg px-3 py-1.5 text-components-button-primary-text hover:bg-components-button-primary-bg-hover"
                onClick={handleCreateAndSelect}
              >
                {t('sidebar.folder.confirm', { ns: 'explore' })}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default React.memo(MoveToFolderModal)

