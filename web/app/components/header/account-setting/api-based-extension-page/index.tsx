import type { ApiBasedExtensionResponse } from '@dify/contracts/api/console/api-based-extension/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useApiBasedExtensions } from '@/service/use-common'
import Empty from './empty'
import Item from './item'
import ApiBasedExtensionModal from './modal'

type ApiBasedExtensionDialogState = {
  extension: Partial<ApiBasedExtensionResponse>
  onSave: () => void
} | null

const ApiBasedExtensionPage = () => {
  const { t } = useTranslation()
  const { data, refetch: mutate, isPending: isLoading } = useApiBasedExtensions()
  const [dialogState, setDialogState] = useState<ApiBasedExtensionDialogState>(null)

  const handleOpenApiBasedExtensionModal = () => {
    setDialogState({
      extension: {},
      onSave: () => mutate(),
    })
  }
  const handleEditApiBasedExtension = (extension: ApiBasedExtensionResponse) => {
    setDialogState({
      extension,
      onSave: () => mutate(),
    })
  }
  const handleSaveApiBasedExtension = () => {
    dialogState?.onSave()
    setDialogState(null)
  }
  const handleApiBasedExtensionModalOpenChange = (open: boolean) => {
    if (!open)
      setDialogState(null)
  }

  return (
    <div>
      {
        !isLoading && !data?.length && (
          <Empty />
        )
      }
      {
        !isLoading && !!data?.length && (
          data.map(item => (
            <Item
              key={item.id}
              data={item}
              onEdit={handleEditApiBasedExtension}
              onUpdate={() => mutate()}
            />
          ))
        )
      }
      <Button
        variant="secondary"
        className="w-full"
        onClick={handleOpenApiBasedExtensionModal}
      >
        <span className="mr-1 i-ri-add-line h-4 w-4" aria-hidden="true" />
        {t('apiBasedExtension.add', { ns: 'common' })}
      </Button>
      {
        dialogState && (
          <ApiBasedExtensionModal
            open
            extension={dialogState.extension}
            onOpenChange={handleApiBasedExtensionModalOpenChange}
            onSave={handleSaveApiBasedExtension}
          />
        )
      }
    </div>
  )
}

export default ApiBasedExtensionPage
