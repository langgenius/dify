import type { FC } from 'react'
import type { ModelProvider } from './declarations'
import type { PluginDetail } from '@/app/components/plugins/types'
import { Trans, useTranslation } from 'react-i18next'
import { SkeletonContainer, SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import { PluginSource } from '@/app/components/plugins/types'
import { IS_CLOUD_EDITION } from '@/config'
import InstallFromMarketplace from './install-from-marketplace'
import ProviderAddedCard from './provider-added-card'
import QuotaPanel from './provider-added-card/quota-panel'
import { providerToPluginId } from './utils'

type ModelProviderPageBodyProps = {
  providers: ModelProvider[]
  filteredConfiguredProviders: ModelProvider[]
  filteredNotConfiguredProviders: ModelProvider[]
  isLoadingModelProviders: boolean
  showEmptyProvider: boolean
  showConfiguredProviders: boolean
  showNotConfiguredProviders: boolean
  showMarketplace: boolean
  enableMarketplace: boolean
  searchText: string
  pluginDetailMap: Map<string, PluginDetail>
  onOpenMarketplace?: () => void
}

function ModelProviderCardSkeleton() {
  return (
    <div className="rounded-xl border-[0.5px] border-components-card-border bg-components-card-bg p-4 shadow-xs">
      <SkeletonContainer className="h-24">
        <SkeletonRow>
          <SkeletonRectangle className="size-10 shrink-0 animate-pulse rounded-lg" />
          <div className="flex flex-1 flex-col gap-1">
            <SkeletonRectangle className="h-4 w-2/5 animate-pulse" />
            <SkeletonRectangle className="h-3 w-1/4 animate-pulse" />
          </div>
          <SkeletonRectangle className="h-8 w-24 animate-pulse rounded-lg" />
        </SkeletonRow>
        <div className="mt-4 flex flex-col gap-2">
          <SkeletonRectangle className="h-3 w-full animate-pulse" />
          <SkeletonRectangle className="h-3 w-3/4 animate-pulse" />
        </div>
      </SkeletonContainer>
    </div>
  )
}

function ModelProviderListSkeleton() {
  const { t } = useTranslation()

  return (
    <div role="status" aria-label={t(($) => $.loading, { ns: 'common' })} className="space-y-2">
      {Array.from({ length: 3 }, (_, index) => (
        <ModelProviderCardSkeleton key={index} />
      ))}
    </div>
  )
}

function EmptyProviderState({ enableMarketplace }: { enableMarketplace: boolean }) {
  const { t } = useTranslation()

  return (
    <div className="rounded-[10px] bg-workflow-process-bg p-4">
      <div className="flex h-10 w-10 items-center justify-center rounded-[10px] border-[0.5px] border-components-card-border bg-components-card-bg shadow-lg backdrop-blur-sm">
        <span aria-hidden className="i-ri-brain-2-line size-5 text-text-primary" />
      </div>
      <div className="mt-2 system-sm-medium text-text-secondary">
        {t(($) => $['modelProvider.emptyProviderTitle'], { ns: 'common' })}
      </div>
      <p className="mt-1 system-xs-regular text-text-tertiary">
        {enableMarketplace ? (
          <Trans
            i18nKey={($) => $['modelProvider.emptyProviderTipWithMarketplace']}
            ns="common"
            components={{
              marketplace: (
                <a
                  href="#model-provider-marketplace"
                  aria-label={t(($) => $['marketplace.difyMarketplace'], { ns: 'plugin' })}
                  className="system-xs-medium text-text-accent hover:underline"
                />
              ),
            }}
          />
        ) : (
          t(($) => $['modelProvider.emptyProviderTip'], { ns: 'common' })
        )}
      </p>
    </div>
  )
}

type ProviderCardListProps = {
  providers: ModelProvider[]
  pluginDetailMap: Map<string, PluginDetail>
  notConfigured?: boolean
}

function isDebuggingProvider(provider: ModelProvider, pluginDetailMap: Map<string, PluginDetail>) {
  return (
    pluginDetailMap.get(providerToPluginId(provider.provider))?.source === PluginSource.debugging
  )
}

function ProviderCardList({ providers, pluginDetailMap, notConfigured }: ProviderCardListProps) {
  const sortedProviders = [...providers].sort((a, b) => {
    const aIsDebuggingPlugin = isDebuggingProvider(a, pluginDetailMap)
    const bIsDebuggingPlugin = isDebuggingProvider(b, pluginDetailMap)

    if (aIsDebuggingPlugin === bIsDebuggingPlugin) return 0

    return aIsDebuggingPlugin ? -1 : 1
  })

  return (
    <div className="relative flex flex-col gap-2">
      {sortedProviders.map((provider) => {
        const pluginDetail = pluginDetailMap.get(providerToPluginId(provider.provider))

        return (
          <ProviderAddedCard
            key={provider.provider}
            notConfigured={notConfigured}
            provider={provider}
            pluginDetail={pluginDetail}
          />
        )
      })}
    </div>
  )
}

const ModelProviderPageBody: FC<ModelProviderPageBodyProps> = ({
  providers,
  filteredConfiguredProviders,
  filteredNotConfiguredProviders,
  isLoadingModelProviders,
  showEmptyProvider,
  showConfiguredProviders,
  showNotConfiguredProviders,
  showMarketplace,
  enableMarketplace,
  searchText,
  pluginDetailMap,
  onOpenMarketplace,
}) => {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-2">
      {IS_CLOUD_EDITION && (
        <div>
          <QuotaPanel providers={providers} />
        </div>
      )}
      {isLoadingModelProviders && (
        <div>
          <ModelProviderListSkeleton />
        </div>
      )}
      {showEmptyProvider && <EmptyProviderState enableMarketplace={enableMarketplace} />}
      {showConfiguredProviders && (
        <ProviderCardList
          providers={filteredConfiguredProviders}
          pluginDetailMap={pluginDetailMap}
        />
      )}
      {showNotConfiguredProviders && (
        <div className="flex flex-col gap-2 pt-2">
          <div className="flex h-5 items-center system-md-semibold text-text-primary">
            {t(($) => $['modelProvider.toBeConfigured'], { ns: 'common' })}
          </div>
          <ProviderCardList
            providers={filteredNotConfiguredProviders}
            notConfigured
            pluginDetailMap={pluginDetailMap}
          />
        </div>
      )}
      {showMarketplace && (
        <div>
          <InstallFromMarketplace
            providers={providers}
            searchText={searchText}
            onOpenMarketplace={onOpenMarketplace}
          />
        </div>
      )}
    </div>
  )
}

export default ModelProviderPageBody
