'use client'

import type { SnippetDetail } from '@/models/snippet'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { cn } from '@/utils/classnames'
import SnippetInfoDropdown from './dropdown'

type SnippetInfoProps = {
  expand: boolean
  snippet: SnippetDetail
}

const SnippetInfo = ({
  expand,
  snippet,
}: SnippetInfoProps) => {
  const { t } = useTranslation('snippet')

  return (
    <div className={cn('flex flex-col', expand ? 'px-2 pb-1 pt-2' : 'p-1')}>
      <div className={cn('flex flex-col', expand ? 'gap-2 rounded-xl p-2' : '')}>
        <div className={cn('flex', expand ? 'items-center justify-between' : 'items-start gap-3')}>
          <div className={cn('shrink-0', !expand && 'ml-1')}>
            <AppIcon
              size={expand ? 'large' : 'small'}
              iconType="emoji"
              icon={snippet.icon}
              background={snippet.iconBackground}
            />
          </div>
          {expand && <SnippetInfoDropdown snippet={snippet} />}
        </div>
        {expand && (
          <div className="min-w-0">
            <div className="truncate text-text-secondary system-md-semibold">
              {snippet.name}
            </div>
            <div className="pt-1 text-text-tertiary system-2xs-medium-uppercase">
              {t('typeLabel')}
            </div>
          </div>
        )}
        {expand && snippet.description && (
          <p className="line-clamp-3 break-words text-text-tertiary system-xs-regular">
            {snippet.description}
          </p>
        )}
      </div>
    </div>
  )
}

export default React.memo(SnippetInfo)
