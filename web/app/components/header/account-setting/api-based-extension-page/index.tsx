import type { ApiBasedExtensionResponse } from '@dify/contracts/api/console/api-based-extension/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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

export function ApiBasedExtensionPage() {
  const { t } = useTranslation()
  const workspacePermissionKeys = useAppContextWithSelector(state => state.workspacePermissionKeys)
  const canManage = hasPermission(workspacePermissionKeys, 'api_extension.manage')
  const { data: apiBasedExtensions = [], isPending: isLoading } = useQuery(consoleQuery.apiBasedExtension.get.queryOptions())
  const [dialogState, setDialogState] = useState<ApiBasedExtensionDialogState>(null)

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
              canManage={canManage}
            />
          ))
        )
      }
      <Button
        variant="secondary"
        className="w-full"
        disabled={!canManage}
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
