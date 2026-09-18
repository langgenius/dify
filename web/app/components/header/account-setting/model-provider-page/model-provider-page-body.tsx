import type { ModelProviderSummaryResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { FC } from 'react'
import type { ModelProviderPluginSummary } from './index'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Trans, useTranslation } from 'react-i18next'
import { SkeletonContainer, SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import { STEP_BY_STEP_TOUR_TARGETS } from '@/app/components/step-by-step-tour/target-registry'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import InstallFromMarketplace from './install-from-marketplace'
import ProviderAddedCard from './provider-added-card'
import QuotaPanel from './provider-added-card/quota-panel'

type ModelProviderPageBodyProps = {
  providers: ModelProviderSummaryResponse[]
  filteredConfiguredProviders: ModelProviderSummaryResponse[]
  filteredNotConfiguredProviders: ModelProviderSummaryResponse[]
  isLoadingModelProviders: boolean
  showEmptyProvider: boolean
  showConfiguredProviders: boolean
  showNotConfiguredProviders: boolean
  showMarketplace: boolean
  enableMarketplace: boolean
  searchText: string
  pluginSummaryMap: Map<string, ModelProviderPluginSummary>
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

function EmptyProviderState({
  enableMarketplace,
  stepByStepTourTarget,
}: {
  enableMarketplace: boolean
  stepByStepTourTarget?: string
}) {
  const { t } = useTranslation()

  return (
    <div
      className="rounded-[10px] bg-workflow-process-bg p-4"
      data-step-by-step-tour-target={stepByStepTourTarget}
    >
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
                >
                  {t(($) => $['mainNav.marketplace'], { ns: 'common' })}
                </a>
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
  firstCardTarget?: string
  providers: ModelProviderSummaryResponse[]
  pluginSummaryMap: Map<string, ModelProviderPluginSummary>
  notConfigured?: boolean
}

function isDebuggingProvider(
  provider: ModelProviderSummaryResponse,
  pluginSummaryMap: Map<string, ModelProviderPluginSummary>,
) {
  return pluginSummaryMap.get(provider.plugin_id)?.source === 'remote'
}

function ProviderCardList({
  firstCardTarget,
  providers,
  pluginSummaryMap,
  notConfigured,
}: ProviderCardListProps) {
  const sortedProviders = [...providers].sort((a, b) => {
    const aIsDebuggingPlugin = isDebuggingProvider(a, pluginSummaryMap)
    const bIsDebuggingPlugin = isDebuggingProvider(b, pluginSummaryMap)

    if (aIsDebuggingPlugin === bIsDebuggingPlugin) return 0

    return aIsDebuggingPlugin ? -1 : 1
  })

  return (
    <div className="relative flex flex-col gap-2">
      {sortedProviders.map((provider, index) => {
        const pluginSummary = pluginSummaryMap.get(provider.plugin_id)

        return (
          <div
            key={provider.provider}
            data-step-by-step-tour-target={index === 0 ? firstCardTarget : undefined}
          >
            <ProviderAddedCard
              notConfigured={notConfigured}
              provider={provider}
              pluginSummary={pluginSummary}
            />
          </div>
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
  pluginSummaryMap,
  onOpenMarketplace,
}) => {
  const { t } = useTranslation()
  const { data: deploymentEdition } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: ({ deployment_edition }) => deployment_edition,
  })

  return (
    <div className="flex flex-col gap-2">
      {deploymentEdition === 'CLOUD' && (
        <div
          data-step-by-step-tour-target={STEP_BY_STEP_TOUR_TARGETS.integrationModelProviderCredits}
        >
          <QuotaPanel providers={providers} />
        </div>
      )}
      {isLoadingModelProviders && (
        <div>
          <ModelProviderListSkeleton />
        </div>
      )}
      {showEmptyProvider && (
        <EmptyProviderState
          enableMarketplace={enableMarketplace}
          stepByStepTourTarget={
            !showConfiguredProviders && !showNotConfiguredProviders
              ? STEP_BY_STEP_TOUR_TARGETS.integrationModelProviderProduction
              : undefined
          }
        />
      )}
      {showConfiguredProviders && (
        <ProviderCardList
          firstCardTarget={STEP_BY_STEP_TOUR_TARGETS.integrationModelProviderProduction}
          providers={filteredConfiguredProviders}
          pluginSummaryMap={pluginSummaryMap}
        />
      )}
      {showNotConfiguredProviders && (
        <div className="flex flex-col gap-2 pt-2">
          <div className="flex h-5 items-center system-md-semibold text-text-primary">
            {t(($) => $['modelProvider.toBeConfigured'], { ns: 'common' })}
          </div>
          <ProviderCardList
            firstCardTarget={
              !showConfiguredProviders
                ? STEP_BY_STEP_TOUR_TARGETS.integrationModelProviderProduction
                : undefined
            }
            providers={filteredNotConfiguredProviders}
            notConfigured
            pluginSummaryMap={pluginSummaryMap}
          />
        </div>
      )}
      {showMarketplace && (
        <div>
          <InstallFromMarketplace
            searchText={searchText}
            onOpenMarketplace={onOpenMarketplace}
            stepByStepTourTarget={STEP_BY_STEP_TOUR_TARGETS.integrationModelProviderInstall}
          />
        </div>
      )}
    </div>
  )
}

export default ModelProviderPageBody
