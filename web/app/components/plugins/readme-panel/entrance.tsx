import React from 'react'
import { useTranslation } from 'react-i18next'
import { RiBookReadLine } from '@remixicon/react'
import cn from '@/utils/classnames'
import type { PluginDetail } from '../types'
import { ReadmeShowType, useReadmePanel } from './context'
import { BUILTIN_TOOLS_ARRAY } from './constants'

export const ReadmeEntrance = ({
  detail,
  showType = ReadmeShowType.drawer,
  className,
  showShortTip = false,
}: {
  detail: PluginDetail
  showType?: ReadmeShowType
  className?: string
  showShortTip?: boolean
}) => {
  const { t } = useTranslation()
  const { openReadme } = useReadmePanel()
  const handleReadmeClick = () => {
    if (detail)
      openReadme(detail, showType)
  }
  if (BUILTIN_TOOLS_ARRAY.includes(detail.id))
    return null

  return (
    <div className={cn('flex flex-col items-start justify-center gap-2 pb-4 pt-0', showType === ReadmeShowType.drawer && 'px-4', className)}>
      {!showShortTip && <div className="relative h-1 w-8 shrink-0">
        <div className="h-px w-full bg-divider-regular"></div>
      </div>}

      <button
        onClick={handleReadmeClick}
        className="flex w-full items-center justify-start gap-1 text-text-tertiary transition-opacity hover:text-text-accent-light-mode-only"
      >
        <div className="relative flex h-3 w-3 items-center justify-center overflow-hidden">
          <RiBookReadLine className="h-3 w-3" />
        </div>
        <span className="text-xs font-normal leading-4">
          {!showShortTip ? t('plugin.readmeInfo.needHelpCheckReadme') : t('plugin.readmeInfo.title')}
        </span>
      </button>
    </div>
  )
}
