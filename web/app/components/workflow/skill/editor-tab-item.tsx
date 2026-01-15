import type { FC } from 'react'
import type { FileAppearanceType } from '../../base/file-uploader/types'
import type { SkillTabItem } from './mock-data'
import { RiCloseLine, RiHome9Line } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import FileTypeIcon from '@/app/components/base/file-uploader/file-type-icon'
import { cn } from '@/utils/classnames'
import { getFileIconType } from './utils'

type EditorTabItemProps = {
  item: SkillTabItem
}

const EditorTabItem: FC<EditorTabItemProps> = ({ item }) => {
  const { t } = useTranslation()
  const isStart = item.type === 'start'
  const isActive = Boolean(item.active)
  const label = isStart ? item.name.toUpperCase() : item.name
  const iconType = isStart ? null : getFileIconType(item.name)

  return (
    <div
      className={cn(
        'group flex shrink-0 items-center gap-1.5 border-r border-components-panel-border-subtle px-2.5 pb-2 pt-2.5',
        isActive ? 'bg-components-panel-bg' : 'bg-transparent',
      )}
    >
      <div className="flex items-center gap-1">
        <div className={cn('flex size-5 items-center justify-center', !isActive && 'opacity-70')}>
          {isStart
            ? (
                <RiHome9Line className="size-4 text-text-tertiary" />
              )
            : (
                <FileTypeIcon type={iconType as FileAppearanceType} size="sm" />
              )}
        </div>
        <span
          className={cn(
            'max-w-40 truncate text-[13px] leading-4',
            isStart ? 'uppercase text-text-tertiary' : 'text-text-tertiary',
            isActive && 'font-medium text-text-primary',
          )}
        >
          {label}
        </span>
      </div>
      {!isStart && (
        <button
          type="button"
          className={cn(
            'ml-0.5 flex size-4 items-center justify-center rounded-[6px] text-text-tertiary',
            isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
          aria-label={t('operation.close', { ns: 'common' })}
        >
          <RiCloseLine className="size-4" />
        </button>
      )}
    </div>
  )
}

export default React.memo(EditorTabItem)
