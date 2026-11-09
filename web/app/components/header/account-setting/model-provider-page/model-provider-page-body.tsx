import type { ModelProviderSummaryResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { FC } from 'react'
import type { ModelProviderPluginSummary } from './index'
import type { MarketplaceLinks } from '@/features/marketplace/links'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Suspense } from 'react'
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
  marketplace: MarketplaceLinks | null
  searchText: string
  pluginSummaryMap: Map<string, ModelProviderPluginSummary>
  onOpenMarketplace?: () => void
}

function ModelProviderCardSkeleton() {
  return (
    <div className="rounded-xl border-[0.5px] border-divider-regular bg-third-party-model-bg-default shadow-xs">
      <div className="flex py-2 ps-3 pe-2">
        <div className="grow px-1 pt-1 pb-0.5">
          <SkeletonRow className="mb-2 h-6">
            <SkeletonRectangle className="my-0 size-6 rounded-md" />
            <SkeletonRectangle className="my-0 h-4 w-28" />
          </SkeletonRow>
          <SkeletonRow className="h-4.5 gap-0.5">
            <SkeletonRectangle className="my-0 h-4.5 w-8 rounded-[5px]" />
            <SkeletonRectangle className="my-0 h-4.5 w-24 rounded-[5px]" />
          </SkeletonRow>
        </div>
        <SkeletonContainer className="ms-1 w-32 shrink-0 justify-between rounded-lg border-[0.5px] border-components-panel-border p-1">
          <SkeletonRectangle className="mx-1.5 mt-1.5 mb-0 h-3 w-16" />
          <SkeletonRectangle className="my-0 h-6 w-full rounded-md" />
        </SkeletonContainer>
      </div>
      <SkeletonRow className="justify-between border-t border-t-divider-subtle py-1.5 ps-3 pe-2.75">
        <SkeletonRectangle className="h-4 w-16" />
        <SkeletonRectangle className="h-4 w-32" />
      </SkeletonRow>
    </div>
  )
}

function ModelProviderListSkeleton() {
  const { t } = useTranslation(['common'])

  return (
    <div
      role="status"
      aria-label={t(($) => $.loading, { ns: 'common' })}
      className="flex flex-col gap-2 motion-safe:animate-pulse"
    >
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
  const { t } = useTranslation(['plugin', 'modelProvider', 'navigation'])

  return (
    <div
      className="rounded-[10px] bg-workflow-process-bg p-4"
      data-step-by-step-tour-target={stepByStepTourTarget}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-[10px] border-[0.5px] border-components-card-border bg-components-card-bg shadow-lg backdrop-blur-sm">
        <span aria-hidden className="i-ri-brain-2-line size-5 text-text-primary" />
      </div>
      <div className="mt-2 system-sm-medium text-text-secondary">
        {t(($) => $['modelProvider.emptyProviderTitle'], { ns: 'modelProvider' })}
      </div>
      <p className="mt-1 system-xs-regular text-text-tertiary">
        {enableMarketplace ? (
          <Trans
            i18nKey={($) => $['modelProvider.emptyProviderTipWithMarketplace']}
            ns="modelProvider"
            components={{
              marketplace: (
                <a
                  href="#model-provider-marketplace"
                  aria-label={t(($) => $['marketplace.difyMarketplace'], { ns: 'plugin' })}
                  className="system-xs-medium text-text-accent hover:underline"
                >
                  {t(($) => $['mainNav.marketplace'], { ns: 'navigation' })}
                </a>
              ),
            }}
          />
        ) : (
          t(($) => $['modelProvider.emptyProviderTip'], { ns: 'modelProvider' })
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
  marketplace,
  searchText,
  pluginSummaryMap,
  onOpenMarketplace,
}) => {
  const { t } = useTranslation(['modelProvider'])
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
      <Suspense
        fallback={
          <div>
            <ModelProviderListSkeleton />
          </div>
        }
      >
        {showEmptyProvider && (
          <EmptyProviderState
            enableMarketplace={marketplace !== null}
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
              {t(($) => $['modelProvider.toBeConfigured'], { ns: 'modelProvider' })}
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
        {!isLoadingModelProviders && marketplace && (
          <div>
            <InstallFromMarketplace
              marketplace={marketplace}
              searchText={searchText}
              onOpenMarketplace={onOpenMarketplace}
              stepByStepTourTarget={STEP_BY_STEP_TOUR_TARGETS.integrationModelProviderInstall}
            />
          </div>
        )}
      </Suspense>
    </div>
  )
}

export default ModelProviderPageBody
