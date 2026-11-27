'use client'

import type { ReactNode } from 'react'
import type { ReadmePanelState } from './store'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { resolveDatasourceIcon } from '@/app/components/rag-pipeline/utils/datasource-icon'
import { useGetLanguage } from '@/context/i18n'
import { consoleQuery } from '@/service/console'
import Icon from '../card/base/card-icon'
import Description from '../card/base/description'
import OrgInfo from '../card/base/org-info'
import Title from '../card/base/title'
import DetailHeader from '../plugin-detail-panel/detail-header'
import { ReadmePanelView } from './view'

type ReadmePanelContentProps = {
  detail: ReadmePanelState['detail']
  title: ReactNode
  closeButton: ReactNode
}

export function ReadmePanelContent({ detail, title, closeButton }: ReadmePanelContentProps) {
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

  return (
    <ReadmePanelView
      title={title}
      closeButton={closeButton}
      readme={readmeData?.readme}
      isLoading={isLoading}
      error={error}
      pluginInfo={{ pluginUniqueIdentifier, pluginId: detail.plugin_id }}
      header={
        'id' in detail ? (
          <DetailHeader detail={detail} isReadmeView={true} />
        ) : (
          <div>
            <div className="flex">
              <div className="overflow-hidden rounded-xl border border-components-panel-border-subtle bg-components-panel-bg">
                <Icon src={resolveDatasourceIcon(detail.declaration.identity.icon)} />
              </div>
              <div className="ms-3 min-w-0 grow">
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
        )
      }
    />
  )
}
