'use client'

import type { ReactNode } from 'react'
import type { MarkdownProps } from '@/app/components/base/markdown'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { Markdown } from '@/app/components/base/markdown'

type ReadmePanelViewProps = {
  title: ReactNode
  closeButton: ReactNode
  header: ReactNode
  readme?: string
  isLoading?: boolean
  error?: unknown
  pluginInfo?: MarkdownProps['pluginInfo']
}

export function ReadmePanelView({
  title,
  closeButton,
  header,
  readme,
  isLoading = false,
  error,
  pluginInfo,
}: ReadmePanelViewProps) {
  const { t } = useTranslation(['plugin'])
  let readmeContent: ReactNode
  if (isLoading) {
    readmeContent = (
      <div className="flex h-40 items-center justify-center">
        <LoadingPlaceholder />
      </div>
    )
  } else if (error) {
    readmeContent = (
      <div className="py-8 text-center text-text-tertiary">
        <p>{t(($) => $['readmeInfo.failedToFetch'], { ns: 'plugin' })}</p>
      </div>
    )
  } else if (readme) {
    readmeContent = <Markdown content={readme} pluginInfo={pluginInfo} />
  } else {
    readmeContent = (
      <div className="py-8 text-center text-text-tertiary">
        <p>{t(($) => $['readmeInfo.noReadmeAvailable'], { ns: 'plugin' })}</p>
      </div>
    )
  }

  return (
    <div className="flex size-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 rounded-t-xl bg-background-body p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1">
            <span
              aria-hidden="true"
              className="i-ri-book-read-line size-3 shrink-0 text-text-tertiary"
            />
            {title}
          </div>
          {closeButton}
        </div>
        {header}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
        {readmeContent}
      </div>
    </div>
  )
}
