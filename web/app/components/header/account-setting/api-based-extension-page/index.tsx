import type { ApiBasedExtensionResponse } from '@dify/contracts/api/console/api-based-extension/types.gen'
import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from '#i18n'
import { SearchInput } from '@/app/components/base/search-input'
import { SkeletonContainer, SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import { consoleQuery } from '@/service/client'
import { hasPermission } from '@/utils/permission'
import { Empty } from './empty'
import { Item } from './item'
import { ApiBasedExtensionModal } from './modal'

type ApiBasedExtensionDialogState = {
  mode: 'create'
} | {
  mode: 'edit'
  apiBasedExtension: ApiBasedExtensionResponse
} | null

type ApiBasedExtensionPageProps = {
  layout?: (parts: { body: ReactNode, toolbar: ReactNode }) => ReactNode
}

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

export function ApiBasedExtensionPage({
  layout,
}: ApiBasedExtensionPageProps = {}) {
  const { t } = useTranslation()
  const workspacePermissionKeys = useAppContextWithSelector(state => state.workspacePermissionKeys)
  const canManage = hasPermission(workspacePermissionKeys, 'api_extension.manage')
  const { data: apiBasedExtensions = [], isPending: isLoading } = useQuery(consoleQuery.apiBasedExtension.get.queryOptions())
  const [dialogState, setDialogState] = useState<ApiBasedExtensionDialogState>(null)
  const [keywords, setKeywords] = useState('')

  const filteredApiBasedExtensions = useMemo(() => {
    const query = keywords.trim().toLowerCase()
    if (!query)
      return apiBasedExtensions

    return apiBasedExtensions.filter((apiBasedExtension) => {
      return apiBasedExtension.name.toLowerCase().includes(query)
        || apiBasedExtension.api_endpoint.toLowerCase().includes(query)
    })
  }, [apiBasedExtensions, keywords])
  const hasApiBasedExtensions = apiBasedExtensions.length > 0
  const hasSearchKeywords = keywords.trim().length > 0

  const handleOpenApiBasedExtensionModal = () => {
    if (!canManage)
      return

    setDialogState({
      mode: 'create',
    })
  }
  const handleEditApiBasedExtension = (apiBasedExtension: ApiBasedExtensionResponse) => {
    if (!canManage)
      return

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

  const toolbar = (
    <div className="flex w-full items-center justify-between gap-2">
      <SearchInput
        className="w-[200px]"
        value={keywords}
        onValueChange={setKeywords}
      />
      <Button
        variant="secondary"
        disabled={!canManage}
        onClick={handleOpenApiBasedExtensionModal}
      >
        <span className="mr-1 i-ri-add-line size-4" aria-hidden="true" />
        {t('apiBasedExtension.add', { ns: 'common' })}
      </Button>
    </div>
  )

  const body = (
    <>
      {
        isLoading && (
          <ApiBasedExtensionListSkeleton />
        )
      }
      {
        !isLoading && !hasApiBasedExtensions && (
          <Empty />
        )
      }
      {
        !isLoading && hasApiBasedExtensions && hasSearchKeywords && !filteredApiBasedExtensions.length && (
          <div className="py-10 text-center system-sm-regular text-text-tertiary">
            {t('dataSource.notion.selector.noSearchResult', { ns: 'common' })}
          </div>
        )
      }
      {
        !isLoading && !!filteredApiBasedExtensions.length && (
          filteredApiBasedExtensions.map(item => (
            <Item
              key={item.id}
              apiBasedExtension={item}
              onEdit={handleEditApiBasedExtension}
              canManage={canManage}
            />
          ))
        )
      }
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
    </>
  )

  if (layout)
    return layout({ body, toolbar })

  return (
    <>
      <div className="mb-3">{toolbar}</div>
      {body}
    </>
  )
}
