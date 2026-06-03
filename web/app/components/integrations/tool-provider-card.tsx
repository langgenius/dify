'use client'

import type { Collection } from '@/app/components/tools/types'
import { cn } from '@langgenius/dify-ui/cn'
import { RiLoginCircleLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Icon from '@/app/components/plugins/card/base/card-icon'
import { useGetLanguage } from '@/context/i18n'
import { renderI18nObject } from '@/i18n-config'

const getCollectionPluginIdentity = (collection: Collection) => {
  const [org, ...nameParts] = collection.plugin_id?.split('/').filter(Boolean) ?? []

  if (org && nameParts.length) {
    return {
      org,
      name: nameParts.join('/'),
    }
  }

  return {
    org: collection.author || '',
    name: collection.name,
  }
}

type IntegrationsToolProviderCardProps = {
  collection: Collection
  current?: boolean
}

function IntegrationsToolProviderCard({
  collection,
  current,
}: IntegrationsToolProviderCardProps) {
  const language = useGetLanguage()
  const { t } = useTranslation()
  const title = renderI18nObject(collection.label, language)
  const description = renderI18nObject(collection.description, language)
  const { org, name } = getCollectionPluginIdentity(collection)
  const toolsCount = collection.tools?.length ?? 0
  const builtInLabel = t('metadata.datasetMetadata.builtIn', { ns: 'dataset' })
  const showBuiltInSource = !collection.plugin_id

  return (
    <div
      data-testid={`card-${collection.name}`}
      data-from={collection.plugin_id ? 'marketplace' : 'package'}
      data-org={collection.plugin_id ? org : ''}
      className={cn(
        'group/tool-provider flex min-w-[min(100%,496px)] flex-1 cursor-pointer flex-col rounded-xl bg-background-section-burn p-[3px]',
        current && 'outline-[1.5px] outline-components-option-card-option-selected-border',
      )}
    >
      <div className="relative flex w-full items-center gap-3 overflow-hidden rounded-[10px] border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg p-3 group-hover/tool-provider:bg-components-panel-on-panel-item-bg-hover">
        <Icon src={collection.icon} size="large" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-px">
          <div className="flex min-w-0 items-center gap-1">
            <div className="min-w-0 truncate system-md-semibold text-text-secondary" title={title}>
              {title}
            </div>
          </div>
          <div className="w-full truncate system-xs-regular text-text-tertiary" title={description}>
            {description}
          </div>
        </div>
      </div>
      <div className="flex h-[26px] w-full items-center gap-2 px-3 pt-1.5 pb-1">
        <div className="flex h-4 min-w-0 shrink-0 items-center gap-0.5 system-xs-regular">
          {!!org && (
            <>
              <div className="truncate text-text-tertiary" title={org}>{org}</div>
              <div className="text-text-quaternary">/</div>
            </>
          )}
          <div className="truncate text-text-tertiary" title={name}>{name}</div>
        </div>
        {toolsCount > 0 && (
          <>
            <div className="shrink-0 system-xs-regular text-text-quaternary">·</div>
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <RiLoginCircleLine className="size-3 shrink-0 text-text-tertiary" />
              <div className="truncate system-xs-regular text-text-tertiary">
                {t('endpointsEnabled', { ns: 'plugin', num: toolsCount })}
              </div>
            </div>
          </>
        )}
        {showBuiltInSource && (
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <div className="system-2xs-medium-uppercase text-text-tertiary">
              {t('from', { ns: 'plugin' })}
            </div>
            <div className="system-2xs-semibold-uppercase text-text-secondary">
              {builtInLabel}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default React.memo(IntegrationsToolProviderCard)
