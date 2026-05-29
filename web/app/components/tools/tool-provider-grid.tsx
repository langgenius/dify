'use client'

import type { Collection } from './types'
import type { ToolCategory } from '@/app/components/integrations/routes'
import type { CardPayload } from '@/app/components/plugins/card'
import { cn } from '@langgenius/dify-ui/cn'
import Card from '@/app/components/plugins/card'
import CardMoreInfo from '@/app/components/plugins/card/card-more-info'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
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

export function ToolProviderGrid({
  activeTab,
  collections,
  currentProviderId,
  frameClassName,
  getTagLabel,
  hasCategoryCollections,
  isLoading,
  isSearchResultEmpty,
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
  isSearchResultEmpty: boolean
  onRefreshData: () => void
  onSelectProvider: (providerId: string) => void
}) {
  const showWorkflowEmptyState = activeTab === 'workflow' && !hasCategoryCollections && !isSearchResultEmpty

  return (
    <div
      className={cn(
        'relative grid shrink-0 grid-cols-1 content-start gap-2 pt-2 pb-4 sm:grid-cols-2 md:grid-cols-3',
        frameClassName,
        showWorkflowEmptyState && 'grow',
      )}
    >
      {isLoading
        ? <ToolCardSkeletonGrid />
        : (
            <>
              {activeTab === 'api' && <CustomCreateCard onRefreshData={onRefreshData} />}
              {collections.map(collection => (
                <div
                  key={collection.id}
                  onClick={() => onSelectProvider(collection.id)}
                >
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
                </div>
              ))}
              {showWorkflowEmptyState && (
                <div className="absolute top-1/2 left-1/2 w-full max-w-[1060px] -translate-x-1/2 -translate-y-1/2 px-6">
                  <WorkflowToolEmpty type={getToolType(activeTab)} />
                </div>
              )}
            </>
          )}
    </div>
  )
}
