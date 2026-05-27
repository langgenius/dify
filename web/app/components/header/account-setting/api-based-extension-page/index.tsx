import type { ApiBasedExtensionResponse } from '@dify/contracts/api/console/api-based-extension/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SkeletonContainer, SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import { consoleQuery } from '@/service/client'
import { Empty } from './empty'
import { Item } from './item'
import { ApiBasedExtensionModal } from './modal'

type ApiBasedExtensionDialogState = {
  mode: 'create'
} | {
  mode: 'edit'
  apiBasedExtension: ApiBasedExtensionResponse
} | null

function ApiBasedExtensionListSkeleton() {
  const { t } = useTranslation()

  return (
    <div role="status" aria-label={t('loading', { ns: 'common' })} className="space-y-2">
      {Array.from({ length: 2 }, (_, index) => (
        <div key={index} className="rounded-xl border-[0.5px] border-components-card-border bg-components-card-bg p-4 shadow-xs">
          <SkeletonContainer className="h-16">
            <SkeletonRow>
              <SkeletonRectangle className="size-8 shrink-0 animate-pulse rounded-lg" />
              <div className="flex flex-1 flex-col gap-1">
                <SkeletonRectangle className="h-4 w-1/3 animate-pulse" />
                <SkeletonRectangle className="h-3 w-1/2 animate-pulse" />
              </div>
              <SkeletonRectangle className="h-8 w-8 animate-pulse rounded-lg" />
            </SkeletonRow>
          </SkeletonContainer>
        </div>
      ))}
    </div>
  )
}

export function ApiBasedExtensionPage() {
  const { t } = useTranslation()
  const { data: apiBasedExtensions = [], isPending: isLoading } = useQuery(consoleQuery.apiBasedExtension.get.queryOptions())
  const [dialogState, setDialogState] = useState<ApiBasedExtensionDialogState>(null)

  const handleOpenApiBasedExtensionModal = () => {
    setDialogState({
      mode: 'create',
    })
  }
  const handleEditApiBasedExtension = (apiBasedExtension: ApiBasedExtensionResponse) => {
    setDialogState({
      mode: 'edit',
      apiBasedExtension,
    })
  }
  const handleApiBasedExtensionSaved = () => {
    setDialogState(null)
  }
  const handleApiBasedExtensionModalOpenChange = (open: boolean) => {
    if (!open)
      setDialogState(null)
  }

  return (
    <div>
      {
        isLoading && (
          <ApiBasedExtensionListSkeleton />
        )
      }
      {
        !isLoading && !apiBasedExtensions.length && (
          <Empty />
        )
      }
      {
        !isLoading && !!apiBasedExtensions.length && (
          apiBasedExtensions.map(item => (
            <Item
              key={item.id}
              apiBasedExtension={item}
              onEdit={handleEditApiBasedExtension}
            />
          ))
        )
      }
      <Button
        variant="secondary"
        className="w-full"
        onClick={handleOpenApiBasedExtensionModal}
      >
        <span className="mr-1 i-ri-add-line size-4" aria-hidden="true" />
        {t('apiBasedExtension.add', { ns: 'common' })}
      </Button>
      {
        dialogState?.mode === 'create' && (
          <ApiBasedExtensionModal
            open
            mode="create"
            onOpenChange={handleApiBasedExtensionModalOpenChange}
            onSaved={handleApiBasedExtensionSaved}
          />
        )
      }
      {
        dialogState?.mode === 'edit' && (
          <ApiBasedExtensionModal
            open
            mode="edit"
            apiBasedExtension={dialogState.apiBasedExtension}
            onOpenChange={handleApiBasedExtensionModalOpenChange}
            onSaved={handleApiBasedExtensionSaved}
          />
        )
      }
    </div>
  )
}
