'use client'

import type { KeyboardEvent } from 'react'
import type { Collection } from './types'
import type { ToolCategory } from '@/app/components/integrations/routes'
import type { CardPayload } from '@/app/components/plugins/card'
import { cn } from '@langgenius/dify-ui/cn'
import IntegrationsToolProviderCard from '@/app/components/integrations/tool-provider-card'
import Card from '@/app/components/plugins/card'
import CardMoreInfo from '@/app/components/plugins/card/card-more-info'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { STEP_BY_STEP_TOUR_TARGETS } from '@/app/components/step-by-step-tour/target-registry'
import CustomCreateCard from '@/app/components/tools/provider/custom-create-card'
import WorkflowToolEmpty from '@/app/components/tools/provider/empty'
import ToolCardSkeletonGrid from '@/app/components/tools/provider/tool-card-skeleton'
import { getToolType } from './utils'

const getCollectionPluginIdentity = (collection: Collection) => {
  const [org, ...nameParts] = collection.plugin_id?.split('/').filter(Boolean) ?? []

  if (org && nameParts.length) {
    return {
      org,
      name: nameParts.join('/'),
    }
  }

  return {
    org: '',
    name: collection.name,
  }
}

const collectionToCardPayload = (collection: Collection): CardPayload => {
  const { org, name } = getCollectionPluginIdentity(collection)

  return {
    ...collection,
    type: 'tool',
    org,
    name,
    plugin_id: collection.plugin_id ?? collection.id,
    version: '',
    latest_version: '',
    latest_package_identifier: '',
    brief: collection.description,
    description: collection.description,
    introduction: '',
    repository: '',
    category: PluginCategoryEnum.tool,
    install_count: 0,
    endpoint: {
      settings: [],
    },
    tags: collection.labels?.map(name => ({ name })) ?? [],
    badges: [],
    verification: {
      authorized_category: 'community',
    },
    verified: false,
    from: collection.plugin_id ? 'marketplace' : 'package',
  }
}

const isKeyboardSelectEvent = (event: KeyboardEvent) =>
  event.key === 'Enter' || event.key === ' '

export function ToolProviderGrid({
  activeTab,
  collections,
  currentProviderId,
  frameClassName,
  getTagLabel,
  hasCategoryCollections,
  isLoading,
  useIntegrationsCard,
  isSearchResultEmpty,
  showCreateCard = true,
  onRefreshData,
  onSelectProvider,
}: {
  activeTab: ToolCategory
  collections: Collection[]
  currentProviderId?: string
  frameClassName: string
  getTagLabel: (label: string) => string
  hasCategoryCollections: boolean
  isLoading: boolean
  useIntegrationsCard?: boolean
  isSearchResultEmpty: boolean
  showCreateCard?: boolean
  onRefreshData: () => void
  onSelectProvider: (providerId: string) => void
}) {
  const showWorkflowEmptyState = activeTab === 'workflow' && !hasCategoryCollections && !isSearchResultEmpty
  const useCustomToolGrid = activeTab === 'api'
  const useThreeColumnIntegrationsGrid = useIntegrationsCard && activeTab !== 'builtin'
  const skeletonVariant = useIntegrationsCard
    ? activeTab === 'workflow' || activeTab === 'api'
      ? 'integrations-labeled'
      : 'integrations-default'
    : 'default'
  const stepByStepTourTarget = activeTab === 'workflow'
    ? STEP_BY_STEP_TOUR_TARGETS.integrationWorkflowToolGrid
    : activeTab === 'api'
      ? STEP_BY_STEP_TOUR_TARGETS.integrationSwaggerToolGrid
      : undefined

  return (
    <div
      data-testid="tool-provider-grid"
      className={cn(
        useCustomToolGrid
          ? 'relative grid w-full shrink-0 grid-cols-1 content-start gap-2.5 pt-1 pb-4 md:grid-cols-2 xl:grid-cols-3'
          : useThreeColumnIntegrationsGrid
            ? 'relative grid w-full shrink-0 grid-cols-1 content-start gap-2 pt-1 pb-4 sm:grid-cols-2 md:grid-cols-3'
            : useIntegrationsCard
              ? 'relative grid w-full shrink-0 grid-cols-1 content-start gap-2 pt-1 pb-4 lg:grid-cols-2'
              : 'relative grid w-full shrink-0 grid-cols-1 content-start gap-2 pt-2 pb-4 sm:grid-cols-2 md:grid-cols-3',
        frameClassName,
        showWorkflowEmptyState && 'grow',
      )}
    >
      {isLoading
        ? <ToolCardSkeletonGrid variant={skeletonVariant} />
        : (
            <>
              {activeTab === 'api' && showCreateCard && (
                <CustomCreateCard
                  onRefreshData={onRefreshData}
                  stepByStepTourTarget={stepByStepTourTarget}
                />
              )}
              {collections.map((collection, index) => (
                <div
                  key={collection.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={currentProviderId === collection.id}
                  data-step-by-step-tour-target={index === 0 ? stepByStepTourTarget : undefined}
                  className={cn(
                    useCustomToolGrid && 'min-w-0',
                    useIntegrationsCard && !useCustomToolGrid && 'min-w-0',
                  )}
                  onKeyDown={(event) => {
                    if (!isKeyboardSelectEvent(event))
                      return

                    event.preventDefault()
                    onSelectProvider(collection.id)
                  }}
                  onClick={() => onSelectProvider(collection.id)}
                >
                  {useIntegrationsCard
                    ? (
                        <IntegrationsToolProviderCard
                          collection={collection}
                          current={currentProviderId === collection.id}
                          showBuiltInBadge={activeTab === 'builtin' && !collection.plugin_id}
                          variant={activeTab === 'workflow' || activeTab === 'api' ? 'labeled' : 'default'}
                        />
                      )
                    : (
                        <Card
                          className={cn(
                            'cursor-pointer',
                            currentProviderId === collection.id && 'border-[1.5px] border-components-option-card-option-selected-border',
                          )}
                          hideCornerMark
                          payload={collectionToCardPayload(collection)}
                          footer={(
                            <CardMoreInfo
                              tags={collection.labels?.map(label => getTagLabel(label)) || []}
                            />
                          )}
                        />
                      )}
                </div>
              ))}
              {showWorkflowEmptyState && (
                <div
                  className="absolute top-1/2 left-1/2 w-full max-w-[1060px] -translate-x-1/2 -translate-y-1/2 px-6"
                  data-step-by-step-tour-target={stepByStepTourTarget}
                >
                  <WorkflowToolEmpty type={getToolType(activeTab)} />
                </div>
              )}
            </>
          )}
    </div>
  )
}
