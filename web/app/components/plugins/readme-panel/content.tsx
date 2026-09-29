'use client'

import type { ReactNode } from 'react'
import type { ReadmePanelState } from './store'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { Markdown } from '@/app/components/base/markdown'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { resolveDatasourceIcon } from '@/app/components/rag-pipeline/utils/datasource-icon'
import { useGetLanguage } from '@/context/i18n'
import { consoleQuery } from '@/service/console'
import Icon from '../card/base/card-icon'
import Description from '../card/base/description'
import OrgInfo from '../card/base/org-info'
import Title from '../card/base/title'
import DetailHeader from '../plugin-detail-panel/detail-header'

type ReadmePanelContentProps = {
  detail: ReadmePanelState['detail']
  title: ReactNode
  closeButton: ReactNode
}

export function ReadmePanelContent({ detail, title, closeButton }: ReadmePanelContentProps) {
  const { t } = useTranslation(['plugin'])
  const language = useLanguage()
  const locale = useGetLanguage()
  const pluginUniqueIdentifier = detail.plugin_unique_identifier

  const {
    data: readmeData,
    isLoading,
    error,
  } = useQuery(
    consoleQuery.workspaces.current.plugin.readme.get.queryOptions({
      input: pluginUniqueIdentifier
        ? {
            query: {
              plugin_unique_identifier: pluginUniqueIdentifier,
              language,
            },
          }
        : skipToken,
    }),
  )

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
  } else if (readmeData?.readme) {
    readmeContent = (
      <Markdown
        content={readmeData.readme}
        pluginInfo={{ pluginUniqueIdentifier, pluginId: detail.plugin_id }}
      />
    )
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
        {'id' in detail ? (
          <DetailHeader detail={detail} isReadmeView={true} />
        ) : (
          <div>
            <div className="flex">
              <div className="overflow-hidden rounded-xl border border-components-panel-border-subtle bg-components-panel-bg">
                <Icon src={resolveDatasourceIcon(detail.declaration.identity.icon)} />
              </div>
              <div className="ml-3 min-w-0 grow">
                <Title
                  title={
                    detail.declaration.identity.label[locale] ??
                    detail.declaration.identity.label.en_US
                  }
                />
                <OrgInfo
                  orgName={detail.declaration.identity.author}
                  packageName={
                    detail.declaration.identity.name.split('/').pop() ??
                    detail.declaration.identity.name
                  }
                  packageNameClassName="w-auto"
                />
              </div>
            </div>
            <Description
              className="mt-2"
              text={
                detail.declaration.identity.description[locale] ??
                detail.declaration.identity.description.en_US
              }
              descriptionLineRows={2}
            />
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
        {readmeContent}
      </div>
    </div>
  )
}
