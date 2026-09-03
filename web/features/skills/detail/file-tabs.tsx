'use client'

import type { SkillFileResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { getPathBaseName, getSkillFileIconClass } from './shared'

export function FileTabs({
  endAction,
  files,
  onClose,
  onSelect,
  previewPath,
  selectedPath,
}: {
  endAction?: ReactNode
  files: SkillFileResponse[]
  onClose: (path: string) => void
  onSelect: (path: string) => void
  previewPath: string | undefined
  selectedPath: string
}) {
  const { t } = useTranslation('skill')

  return (
    <div className="flex h-11 shrink-0 items-stretch overflow-hidden rounded-t-lg border-b-[0.5px] border-divider-subtle bg-components-panel-bg-alt">
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden">
        <div className="flex w-max min-w-full items-stretch">
          {files.map((file) => {
            const selected = file.path === selectedPath
            const preview = file.path === previewPath
            const closable = file.path !== 'SKILL.md'

            return (
              <div
                key={file.path}
                className={cn(
                  'group/tab flex h-11 max-w-53.5 shrink-0 items-center border-r-[0.5px] border-divider-subtle',
                  selected && 'bg-components-panel-bg',
                  !closable && 'w-26.5',
                )}
              >
                <button
                  type="button"
                  title={file.path}
                  className={cn(
                    'flex h-full min-w-0 cursor-pointer items-center gap-1 py-2.5 pl-2.5 text-left outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:ring-inset',
                    closable ? 'pr-0.5' : 'pr-2.5',
                  )}
                  onClick={() => onSelect(file.path)}
                >
                  <span aria-hidden className="flex size-5 shrink-0 items-center justify-center">
                    <span
                      className={cn(
                        'size-4',
                        getSkillFileIconClass(file),
                        (!selected || !closable) && 'opacity-70',
                        closable && 'group-hover/tab:opacity-100',
                      )}
                    />
                  </span>
                  <span
                    className={cn(
                      'max-w-40 truncate system-sm-medium group-hover/tab:text-text-secondary',
                      selected ? 'text-text-primary' : 'text-text-tertiary',
                      preview && 'italic',
                    )}
                  >
                    {getPathBaseName(file.path)}
                  </span>
                </button>
                {closable && (
                  <button
                    type="button"
                    aria-label={t(($) => $['skillManagement.detail.closeFileTab'], {
                      name: file.path,
                    })}
                    className={cn(
                      'mr-2 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-state-accent-solid',
                      selected
                        ? 'opacity-100'
                        : 'opacity-0 group-focus-within/tab:opacity-100 group-hover/tab:opacity-100',
                    )}
                    onClick={() => onClose(file.path)}
                  >
                    <span aria-hidden className="i-ri-close-line size-4" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
      {endAction ? <div className="flex shrink-0 items-center px-2">{endAction}</div> : null}
    </div>
  )
}
