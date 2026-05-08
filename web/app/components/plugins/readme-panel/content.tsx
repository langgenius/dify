'use client'

import type { ReactNode } from 'react'
import type { PluginDetail } from '../types'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { Markdown } from '@/app/components/base/markdown'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { usePluginReadme } from '@/service/use-plugins'
import DetailHeader from '../plugin-detail-panel/detail-header'

type ReadmePanelContentProps = {
  detail: PluginDetail
  title: ReactNode
  closeButton: ReactNode
}

export function ReadmePanelContent({
  detail,
  title,
  closeButton,
}: ReadmePanelContentProps) {
  const { t } = useTranslation()
  const language = useLanguage()
  const pluginUniqueIdentifier = detail.plugin_unique_identifier || ''

  const { data: readmeData, isLoading, error } = usePluginReadme({
    plugin_unique_identifier: pluginUniqueIdentifier,
    language: language === 'zh-Hans' ? undefined : language,
  })

  let readmeContent: ReactNode
  if (isLoading) {
    readmeContent = (
      <div className="flex h-40 items-center justify-center">
        <Loading type="area" />
      </div>
    )
  }
  else if (error) {
    readmeContent = (
      <div className="py-8 text-center text-text-tertiary">
        <p>{t('readmeInfo.failedToFetch', { ns: 'plugin' })}</p>
      </div>
    )
  }
  else if (readmeData?.readme) {
    readmeContent = (
      <Markdown
        content={readmeData.readme}
        pluginInfo={{ pluginUniqueIdentifier, pluginId: detail.plugin_id }}
      />
    )
  }
  else {
    readmeContent = (
      <div className="py-8 text-center text-text-tertiary">
        <p>{t('readmeInfo.noReadmeAvailable', { ns: 'plugin' })}</p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="shrink-0 rounded-t-xl bg-background-body px-4 py-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1">
            <span aria-hidden="true" className="i-ri-book-read-line h-3 w-3 shrink-0 text-text-tertiary" />
            {title}
          </div>
          {closeButton}
        </div>
        <DetailHeader detail={detail} isReadmeView={true} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
        {readmeContent}
      </div>
    </div>
  )
}
