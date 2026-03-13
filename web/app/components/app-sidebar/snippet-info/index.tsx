'use client'

import type { SnippetDetail } from '@/models/snippet'
import * as React from 'react'
import AppIcon from '@/app/components/base/app-icon'
import Badge from '@/app/components/base/badge'
import { cn } from '@/utils/classnames'

type SnippetInfoProps = {
  expand: boolean
  snippet: SnippetDetail
}

const SnippetInfo = ({
  expand,
  snippet,
}: SnippetInfoProps) => {
  return (
    <div className={cn('flex flex-col', expand ? '' : 'p-1')}>
      <div className="flex flex-col gap-2 p-2">
        <div className="flex items-start gap-3">
          <div className={cn(!expand && 'ml-1')}>
            <AppIcon
              size={expand ? 'large' : 'small'}
              iconType="emoji"
              icon={snippet.icon}
              background={snippet.iconBackground}
            />
          </div>
          {expand && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-text-secondary system-md-semibold">
                {snippet.name}
              </div>
              {snippet.status && (
                <div className="pt-1">
                  <Badge>{snippet.status}</Badge>
                </div>
              )}
            </div>
          )}
        </div>
        {expand && snippet.description && (
          <p className="line-clamp-3 text-text-tertiary system-xs-regular">
            {snippet.description}
          </p>
        )}
      </div>
    </div>
  )
}

export default React.memo(SnippetInfo)
