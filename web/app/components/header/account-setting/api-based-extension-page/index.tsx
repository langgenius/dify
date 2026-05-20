import type { ApiBasedExtensionResponse } from '@dify/contracts/api/console/api-based-extension/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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
